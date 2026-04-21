import { nanoid } from 'nanoid';
import { PIPELINE_PHASES, nextPhase, type Phase } from '@/lib/const/phases';
import { ROLE_KEYS, type RoleKey } from '@/lib/const/roles';
import {
  HUMAN_GATED_PHASES,
  PHASE_NEEDS_REVIEW,
  PHASE_PRIMARY_ROLES,
  TERMINAL_PHASES,
  rolesForPhase,
} from '@/lib/const/phase-roles';
import {
  clearPhaseApproval,
  isPhaseApproved,
} from './phase-approvals';
import { emit, subscribe } from '@/lib/events/bus';
import {
  appendEvent,
  readArtifact,
  readState,
  writeState,
} from '@/lib/workspace/fs';
import {
  pickNextReadyForDev,
  readTicketsIndex,
} from '@/lib/workspace/tickets';
import { readIncidentsIndex } from '@/lib/workspace/incidents';
import { validateGate } from './gate';
import { enforceBudgets } from './budget';
import {
  claimNextForRole,
  completeTask,
  dropPendingTasks,
  enqueueTask,
  failTask,
  hasLiveTaskWithPayload,
  listBacklog,
  type BacklogTask,
  type TaskKind,
} from './backlog';
import { runTaskHandler } from './task-handlers';
import {
  inferDevRoleFromTitle,
  isDevRole,
  type ImplementSummary,
} from './implement';
import { resolveAllEmployeeConfigs, resolveEmployeeConfig } from '@/lib/employees/config';

const DEFAULT_SUPERVISOR_TICK_MS = 1_000;
const DEFAULT_IDLE_BUFFER_MS = 15_000;

function getSupervisorTickMs(): number {
  const raw = Number(process.env.OLYMPUS_SUPERVISOR_TICK_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.max(100, raw) : DEFAULT_SUPERVISOR_TICK_MS;
}

export function getPhaseIdleBufferMs(): number {
  const raw = Number(process.env.OLYMPUS_PHASE_IDLE_BUFFER_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_BUFFER_MS;
}

type WorkerState = 'idle' | 'working' | 'stopped';

type Worker = {
  id: string;
  role: RoleKey;
  state: WorkerState;
  currentTaskId: string | null;
  currentTaskSlug: string | null;
  pollMs: number;
  acceptedKinds: readonly TaskKind[] | null;
  loop: Promise<void>;
};

type SoftwareHouse = {
  projectId: string;
  workers: Map<string, Worker>;
  supervisorLoop: Promise<void>;
  stopRequested: boolean;
  awaitingHumanForPhase: Phase | null;
  lastSeededPhase: Phase | null;
  phaseIdleSinceMs: number | null;
  // remembers which `${phase}:${taskKind}` combinations have already been
  // dispatched this phase so the supervisor does not re-seed a one-shot
  // primary every tick and keep the phase "busy" forever.
  primedTaskKinds: Set<string>;
  unsubscribeBus: () => void;
};

// one-shot primary tasks: phases that have a single lead role turn per
// phase entry. The supervisor seeds them once on phase entry, and the
// reviewer/human loop drives any re-runs beyond that.
const ONE_SHOT_PRIMARY_KIND: Partial<Record<Phase, TaskKind>> = {
  INTAKE: 'orchestrator-intake',
  SPEC: 'pm-spec',
  ARCHITECT: 'architect-design',
  PLAN: 'techlead-plan',
  BRINGUP: 'devops-bringup',
  QA_MANUAL: 'qa-plan',
  SELF_HEAL: 'incident-triage',
  SECURITY: 'security-review',
  RELEASE: 'release-notes',
  DEMO: 'writer-demo',
};

// artifacts that prove the one-shot primary already ran on disk; used to
// seed `primedTaskKinds` on cold start / HMR so we don't re-dispatch a
// turn the producer already completed in a previous session.
const PHASE_PRIMARY_ARTIFACT: Partial<Record<Phase, string>> = {
  INTAKE: 'REQUIREMENTS.md',
  SPEC: 'SPEC.md',
  ARCHITECT: 'ARCHITECTURE.md',
  PLAN: 'PLAN.md',
  QA_MANUAL: 'qa/test-plan.md',
  SECURITY: 'SECURITY_REVIEW.md',
  RELEASE: 'CHANGELOG.md',
};

function primedKey(phase: Phase, kind: TaskKind): string {
  return `${phase}:${kind}`;
}

type HouseStore = Map<string, SoftwareHouse>;

declare global {
  // eslint-disable-next-line no-var
  var __olympus_house__: HouseStore | undefined;
}

function getStore(): HouseStore {
  if (!globalThis.__olympus_house__) {
    globalThis.__olympus_house__ = new Map();
  }
  return globalThis.__olympus_house__;
}

// ensures one long-running software house per project. Subsequent calls are
// idempotent: they nudge the existing house (seeding the current phase +
// optionally delivering a human message) rather than spinning a duplicate.
export async function ensureSoftwareHouse(input: {
  projectId: string;
  humanMessage?: string | null;
}): Promise<SoftwareHouse> {
  const { projectId } = input;
  const store = getStore();
  let house = store.get(projectId);

  if (!house) {
    house = spawnSoftwareHouse(projectId);
    store.set(projectId, house);
  }

  if (input.humanMessage) {
    await handleHumanMessage(house, input.humanMessage);
  }

  await seedCurrentPhase(house);
  return house;
}

export function isSoftwareHouseRunning(projectId: string): boolean {
  return getStore().has(projectId);
}

export async function stopSoftwareHouse(projectId: string): Promise<void> {
  const house = getStore().get(projectId);
  if (!house) return;
  house.stopRequested = true;
  for (const worker of house.workers.values()) worker.state = 'stopped';
  house.unsubscribeBus();
  getStore().delete(projectId);
}

function spawnSoftwareHouse(projectId: string): SoftwareHouse {
  const workers = new Map<string, Worker>();

  const unsubscribeBus = subscribe(projectId, (event) => {
    // a human reply clears the awaiting-human flag and re-seeds the phase so
    // the relevant role picks the turn up immediately rather than after the
    // supervisor tick.
    if (event.kind === 'message.created' && event.message.author.kind === 'human') {
      const house = getStore().get(projectId);
      if (!house) return;
      house.awaitingHumanForPhase = null;
    }
  });

  const house: SoftwareHouse = {
    projectId,
    workers,
    stopRequested: false,
    awaitingHumanForPhase: null,
    lastSeededPhase: null,
    phaseIdleSinceMs: null,
    primedTaskKinds: new Set<string>(),
    unsubscribeBus,
    supervisorLoop: Promise.resolve(),
  };

  // on cold-start, mark one-shot primaries as primed if their artifact is
  // already on disk. Without this, the supervisor would re-dispatch the
  // same turn after every restart and churn through tokens.
  void hydratePrimedFromDisk(house);

  const employees = resolveAllEmployeeConfigs();
  for (const employee of employees) {
    if (!employee.enabled) continue;
    for (let index = 0; index < employee.concurrency; index += 1) {
      const worker: Worker = {
        id: `${employee.role}-${index + 1}-${nanoid(6)}`,
        role: employee.role,
        state: 'idle',
        currentTaskId: null,
        currentTaskSlug: null,
        pollMs: employee.pollMs,
        acceptedKinds: employee.accepts,
        loop: Promise.resolve(),
      };
      worker.loop = runWorkerLoop(house, worker);
      workers.set(worker.id, worker);
    }
  }

  house.supervisorLoop = runSupervisorLoop(house);
  void emitLog(projectId, 'info', 'software-house: spawned workers for all roles');

  return house;
}

async function hydratePrimedFromDisk(house: SoftwareHouse): Promise<void> {
  for (const [phase, kind] of Object.entries(ONE_SHOT_PRIMARY_KIND) as [
    Phase,
    TaskKind,
  ][]) {
    const artifactPath = PHASE_PRIMARY_ARTIFACT[phase];
    if (!artifactPath) continue;
    const content = await readArtifact(house.projectId, artifactPath);
    if (content !== null) {
      house.primedTaskKinds.add(primedKey(phase, kind));
    }
  }
}

async function runWorkerLoop(house: SoftwareHouse, worker: Worker): Promise<void> {
  while (!house.stopRequested) {
    // reload the employee config each tick so per-role pollMs / accepts
    // changes picked up without restarting the house.
    const live = resolveEmployeeConfig(worker.role);
    if (!live.enabled) {
      worker.state = 'idle';
      await sleep(live.pollMs);
      continue;
    }
    worker.pollMs = live.pollMs;
    worker.acceptedKinds = live.accepts;

    const paused = await isProjectPaused(house.projectId);
    if (paused) {
      worker.state = 'idle';
      await sleep(worker.pollMs);
      continue;
    }

    const task = claimNextForRole(
      house.projectId,
      worker.role,
      worker.id,
      worker.acceptedKinds,
    );
    if (!task) {
      worker.state = 'idle';
      worker.currentTaskId = null;
      worker.currentTaskSlug = null;
      await sleep(worker.pollMs);
      continue;
    }

    worker.state = 'working';
    worker.currentTaskId = task.id;
    worker.currentTaskSlug = task.slug;

    try {
      const outcome = await runTaskHandler(task);
      completeTask(house.projectId, task.id);

      // one-shot primaries shouldn't be auto-seeded again for this phase
      // entry. Reviewer / human barge-in still re-enqueues directly.
      if (ONE_SHOT_PRIMARY_KIND[task.phase] === task.kind) {
        house.primedTaskKinds.add(primedKey(task.phase, task.kind));
      }

      if (outcome.awaitingHuman) {
        house.awaitingHumanForPhase = task.phase;
      }

      if (outcome.advanceRequest) {
        // reset idle timer so the supervisor promotes the phase on its next
        // tick rather than waiting for the full buffer.
        house.phaseIdleSinceMs = Date.now() - getPhaseIdleBufferMs();
      }
    } catch (error) {
      failTask(house.projectId, task.id);
      const message = error instanceof Error ? error.message : String(error);
      await emitLog(
        house.projectId,
        'error',
        `worker ${worker.id} task ${task.kind} failed: ${message}`,
      );
    } finally {
      worker.state = 'idle';
      worker.currentTaskId = null;
      worker.currentTaskSlug = null;
    }
  }

  worker.state = 'stopped';
}

async function runSupervisorLoop(house: SoftwareHouse): Promise<void> {
  const tickMs = getSupervisorTickMs();

  while (!house.stopRequested) {
    try {
      await supervisorTick(house);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitLog(house.projectId, 'error', `supervisor tick failed: ${message}`);
    }
    await sleep(tickMs);
  }
}

async function supervisorTick(house: SoftwareHouse): Promise<void> {
  const state = await readState(house.projectId).catch(() => null);
  if (!state) return;

  if (state.paused) {
    house.phaseIdleSinceMs = null;
    return;
  }

  const budget = await enforceBudgets(house.projectId);
  if (!budget.ok) {
    house.phaseIdleSinceMs = null;
    return;
  }

  const phase = state.phase;

  // every tick, re-seed so newly unblocked IMPLEMENT tickets / incidents /
  // phase-entry tasks enter the backlog for workers to pick up.
  await seedPhaseTasks(house, phase);
  house.lastSeededPhase = phase;

  const humanWaiting =
    HUMAN_GATED_PHASES.has(phase) && house.awaitingHumanForPhase === phase;
  if (humanWaiting) {
    house.phaseIdleSinceMs = null;
    return;
  }

  const activity = assessPhaseActivity(house, phase);
  if (activity.busy) {
    house.phaseIdleSinceMs = null;
    return;
  }

  if (TERMINAL_PHASES.has(phase)) {
    house.phaseIdleSinceMs = null;
    return;
  }

  // review-gated phases only advance after a reviewer approve. If no review
  // is pending yet (e.g. we cold-started into a phase whose artifact already
  // exists), seed one so the reviewer can evaluate. Human-gated phases skip
  // this: the human drives those forward, and the reviewer kicks in only
  // once the orchestrator declares advance.
  if (PHASE_NEEDS_REVIEW.has(phase) && !isPhaseApproved(house.projectId, phase)) {
    if (!HUMAN_GATED_PHASES.has(phase)) {
      await ensurePhaseReviewSeed(house.projectId, phase);
    }
    house.phaseIdleSinceMs = null;
    return;
  }

  if (house.phaseIdleSinceMs === null) {
    house.phaseIdleSinceMs = Date.now();
    return;
  }

  const idleFor = Date.now() - house.phaseIdleSinceMs;
  if (idleFor < getPhaseIdleBufferMs()) return;

  const target = nextPhase(phase);
  if (!target) {
    house.phaseIdleSinceMs = null;
    return;
  }

  const advanced = await tryAdvancePhase(house.projectId, phase, target);
  if (advanced) {
    clearPhaseApproval(house.projectId, phase);
    // fresh phase gets a clean primed slate so its primary role can be
    // seeded once on entry, and we drop the leaving phase's entries to
    // keep the set from growing unbounded over long runs.
    house.primedTaskKinds.clear();
    house.phaseIdleSinceMs = null;
    house.awaitingHumanForPhase = null;
  } else {
    // hold the idle clock steady — the supervisor will re-evaluate on the
    // next tick rather than resetting.
  }
}

// if the phase needs review but there's neither a primary-role task nor a
// reviewer task live, seed a phase-review so the reviewer can assess the
// artifact already on disk. Used on cold-start or after HMR wipes memory
// state but disk state already represents a finished role turn.
async function ensurePhaseReviewSeed(projectId: string, phase: Phase): Promise<void> {
  const liveReview = listBacklog(projectId, {
    kind: 'phase-review',
    statuses: ['pending', 'in-progress'],
  }).some((task) => (task.payload.targetPhase as Phase | undefined) === phase);
  if (liveReview) return;

  const primaryLive = listBacklog(projectId, {
    phase,
    statuses: ['pending', 'in-progress'],
  }).some((task) => task.kind !== 'phase-review');
  if (primaryLive) return;

  enqueueTask({
    projectId,
    phase,
    kind: 'phase-review',
    role: 'reviewer',
    payload: { targetPhase: phase, attempt: 1 },
  });
}

type PhaseActivity = {
  busy: boolean;
  pendingTasks: number;
  busyWorkers: number;
};

function assessPhaseActivity(house: SoftwareHouse, phase: Phase): PhaseActivity {
  const rolesForThisPhase = new Set<RoleKey>(PHASE_PRIMARY_ROLES[phase]);

  const pendingTasks = listBacklog(house.projectId, {
    phase,
    statuses: ['pending', 'in-progress'],
  }).length;

  let busyWorkers = 0;
  for (const worker of house.workers.values()) {
    if (worker.state !== 'working') continue;
    if (rolesForThisPhase.has(worker.role)) busyWorkers += 1;
  }

  return {
    busy: pendingTasks > 0 || busyWorkers > 0,
    pendingTasks,
    busyWorkers,
  };
}

async function tryAdvancePhase(
  projectId: string,
  fromPhase: Phase,
  toPhase: Phase,
): Promise<boolean> {
  const gate = await validateGate(projectId, toPhase);
  const failingCheck = gate.checks.find((c) => !c.ok)?.label;

  await appendEvent(
    emit({
      projectId,
      kind: 'gate.evaluated',
      targetPhase: toPhase,
      ok: gate.ok,
      failingCheck,
    }),
  );

  if (!gate.ok) {
    await emitLog(
      projectId,
      'info',
      `software-house: gate ${fromPhase} → ${toPhase} failed (${failingCheck ?? 'unknown'}); holding phase`,
    );
    return false;
  }

  await advancePhaseState(projectId, fromPhase, toPhase);

  // INTEGRATE is purely a bookkeeping phase; chain straight into BRINGUP so
  // the orchestrator does not sit idle waiting for a no-op phase buffer.
  if (toPhase === 'INTEGRATE') {
    await advancePhaseState(projectId, 'INTEGRATE', 'BRINGUP');
  }

  return true;
}

async function advancePhaseState(
  projectId: string,
  fromPhase: Phase,
  toPhase: Phase,
): Promise<void> {
  const state = await readState(projectId);
  if (state.phase !== fromPhase) return;

  const now = new Date().toISOString();
  const history = [...state.phaseHistory];
  const open = history.findIndex(
    (entry) => entry.phase === fromPhase && entry.status === 'running',
  );
  if (open >= 0) {
    history[open] = { ...history[open]!, endedAt: now, status: 'done' };
  }
  history.push({ phase: toPhase, startedAt: now, status: 'running' });

  await writeState({ ...state, phase: toPhase, phaseHistory: history });
  await appendEvent(emit({ projectId, kind: 'phase.advanced', fromPhase, toPhase }));
}

// enters the current phase in the backlog if nothing is there yet. For
// phases with per-unit work (tickets, incidents) this also seeds every
// eligible unit so workers can fan out in parallel.
async function seedCurrentPhase(house: SoftwareHouse): Promise<void> {
  const state = await readState(house.projectId).catch(() => null);
  if (!state) return;
  await seedPhaseTasks(house, state.phase);
}

async function seedPhaseTasks(house: SoftwareHouse, phase: Phase): Promise<void> {
  switch (phase) {
    case 'INTAKE':
      await seedSingleRoleTask(house, phase, 'orchestrator-intake', 'orchestrator');
      return;
    case 'CLARIFY':
      // only seed CLARIFY on human input — the human-message handler is
      // responsible for pushing the task. Supervisor no-op avoids burning
      // budget on questions the human has not yet answered.
      return;
    case 'SPEC':
      await seedSingleRoleTask(house, phase, 'pm-spec', 'pm');
      return;
    case 'ARCHITECT':
      await seedSingleRoleTask(house, phase, 'architect-design', 'architect');
      return;
    case 'PLAN':
      await seedSingleRoleTask(house, phase, 'techlead-plan', 'techlead');
      return;
    case 'IMPLEMENT':
      await seedImplementTasks(house.projectId);
      return;
    case 'REVIEW':
    case 'INTEGRATE':
      return;
    case 'BRINGUP':
      await seedSingleRoleTask(house, phase, 'devops-bringup', 'devops');
      return;
    case 'QA_MANUAL':
      await seedSingleRoleTask(house, phase, 'qa-plan', 'qa');
      return;
    case 'SELF_HEAL':
      await seedSelfHealTasks(house);
      return;
    case 'SECURITY':
      await seedSingleRoleTask(house, phase, 'security-review', 'security');
      return;
    case 'RELEASE':
      await seedSingleRoleTask(house, phase, 'release-notes', 'release');
      return;
    case 'DEMO':
      await seedSingleRoleTask(house, phase, 'writer-demo', 'writer');
      return;
    default:
      return;
  }
}

async function seedSingleRoleTask(
  house: SoftwareHouse,
  phase: Phase,
  kind: TaskKind,
  role: RoleKey,
): Promise<void> {
  // primed guard: one-shot primaries must not be dispatched a second time
  // purely because the first task finished and the backlog is empty. The
  // reviewer and human flows are responsible for any re-run.
  if (
    ONE_SHOT_PRIMARY_KIND[phase] === kind &&
    house.primedTaskKinds.has(primedKey(phase, kind))
  ) {
    return;
  }

  const existing = listBacklog(house.projectId, {
    kind,
    statuses: ['pending', 'in-progress'],
  });
  if (existing.length > 0) return;

  enqueueTask({ projectId: house.projectId, phase, kind, role });
}

async function seedImplementTasks(projectId: string): Promise<void> {
  const index = await readTicketsIndex(projectId);
  if (!index) return;

  // dev seeds — every ticket ready to pick up gets a ticket-dev task. The
  // backlog's dedupe guard means re-calling this every supervisor tick is
  // safe.
  while (true) {
    const nextTicket = pickNextReadyForDev(index);
    if (!nextTicket) break;

    const role: RoleKey = isDevRole(nextTicket.assigneeRole)
      ? nextTicket.assigneeRole
      : inferDevRoleFromTitle(nextTicket.title);

    const alreadyLive = hasLiveTaskWithPayload(
      projectId,
      'ticket-dev',
      'ticketCode',
      nextTicket.code,
    );
    if (alreadyLive) break;

    enqueueTask({
      projectId,
      phase: 'IMPLEMENT',
      kind: 'ticket-dev',
      role,
      payload: { ticketCode: nextTicket.code },
    });
    // mutate the local index snapshot so pickNext… walks past this ticket
    // on the next iteration without another disk read.
    const localEntry = index.tickets.find((t) => t.code === nextTicket.code);
    if (localEntry) localEntry.status = 'in-progress';
  }

  // review seeds — any ticket sitting in `review` without a live reviewer
  // task waiting needs one. Pulled from the fresh index this tick so we
  // pick up tickets that just transitioned from in-progress → review.
  const freshIndex = await readTicketsIndex(projectId);
  if (!freshIndex) return;

  for (const ticket of freshIndex.tickets) {
    if (ticket.status !== 'review') continue;
    const alreadyLive = hasLiveTaskWithPayload(
      projectId,
      'ticket-review',
      'ticketCode',
      ticket.code,
    );
    if (alreadyLive) continue;
    enqueueTask({
      projectId,
      phase: 'IMPLEMENT',
      kind: 'ticket-review',
      role: 'reviewer',
      payload: { ticketCode: ticket.code },
    });
  }
}

async function seedSelfHealTasks(house: SoftwareHouse): Promise<void> {
  const incidentsIndex = await readIncidentsIndex(house.projectId);
  const openIncidents = incidentsIndex?.incidents.filter(
    (entry) => entry.status !== 'resolved' && entry.status !== 'escalated',
  );

  if (!openIncidents || openIncidents.length === 0) {
    // triage runs once per SELF_HEAL entry; the primed guard prevents a
    // fresh triage dispatch on every tick after it already returned.
    const triageKey = primedKey('SELF_HEAL', 'incident-triage');
    if (house.primedTaskKinds.has(triageKey)) return;
    const existing = listBacklog(house.projectId, {
      kind: 'incident-triage',
      statuses: ['pending', 'in-progress'],
    });
    if (existing.length === 0) {
      enqueueTask({
        projectId: house.projectId,
        phase: 'SELF_HEAL',
        kind: 'incident-triage',
        role: 'incident',
      });
    }
    return;
  }

  for (const incident of openIncidents) {
    const alreadyLive = hasLiveTaskWithPayload(
      house.projectId,
      'incident-heal',
      'incidentId',
      incident.id,
    );
    if (alreadyLive) continue;

    const role = incident.dispatch ?? 'incident';
    enqueueTask({
      projectId: house.projectId,
      phase: 'SELF_HEAL',
      kind: 'incident-heal',
      role,
      payload: { incidentId: incident.id },
    });
  }
}

// phase → primary task the human message reroutes to. Any phase in this map
// is also review-gated (except INTAKE), meaning the human can barge in
// anywhere in the planning / requirement-gathering / task-generation chain
// and the primary role will re-run with the fresh input.
const HUMAN_MESSAGE_ROUTES: Partial<Record<Phase, { kind: TaskKind; role: RoleKey }>> = {
  INTAKE: { kind: 'orchestrator-intake', role: 'orchestrator' },
  CLARIFY: { kind: 'orchestrator-clarify', role: 'orchestrator' },
  SPEC: { kind: 'pm-spec', role: 'pm' },
  ARCHITECT: { kind: 'architect-design', role: 'architect' },
  PLAN: { kind: 'techlead-plan', role: 'techlead' },
};

async function handleHumanMessage(house: SoftwareHouse, humanMessage: string): Promise<void> {
  const state = await readState(house.projectId).catch(() => null);
  if (!state) return;

  house.awaitingHumanForPhase = null;

  const route = HUMAN_MESSAGE_ROUTES[state.phase];
  if (!route) {
    // outside the planning chain a human message is ambient context only;
    // workers pick it up from the workspace on their next turn.
    return;
  }

  // the artifact under review is about to be rewritten — invalidate any
  // stale reviewer task queued on disk contents that no longer reflect the
  // latest human intent. The re-run produces a fresh artifact and the
  // reviewer gets re-seeded when that role turn finishes with advance=true.
  dropPendingTasks(house.projectId, {
    phase: state.phase,
    kind: 'phase-review',
    statuses: ['pending'],
  });
  clearPhaseApproval(house.projectId, state.phase);

  enqueueTask({
    projectId: house.projectId,
    phase: state.phase,
    kind: route.kind,
    role: route.role,
    humanMessage,
  });
}

async function isProjectPaused(projectId: string): Promise<boolean> {
  try {
    const state = await readState(projectId);
    return state.paused === true;
  } catch {
    return false;
  }
}

async function emitLog(
  projectId: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
): Promise<void> {
  await appendEvent(emit({ projectId, kind: 'log', level, message }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------------
// compatibility shims so the existing HTTP endpoints keep working.
// They block the caller until the house has finished a specific phase or
// stalled (paused / budget exhausted / wait timeout).
// ----------------------------------------------------------------------

type WaitForPhaseLeaveInput = {
  projectId: string;
  waitForPhase: Phase;
  reason: string;
  timeoutMs?: number;
};

const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

export async function runSoftwareHouseUntilPhaseLeaves(
  input: WaitForPhaseLeaveInput,
): Promise<ImplementSummary> {
  const house = await ensureSoftwareHouse({ projectId: input.projectId });
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  const completed: string[] = [];
  const changesRequested: string[] = [];
  const blocked: string[] = [];
  let steps = 0;
  let paused = false;
  let reason: string | undefined;

  // observe work counters by subscribing while we wait so the caller gets a
  // summary shaped like the old implement/self-heal loops even though the
  // real work happens on the shared workers.
  const stopListener = subscribe(input.projectId, (event) => {
    if (event.kind === 'ticket.status') {
      if (event.status === 'done') completed.push(event.code);
      if (event.status === 'changes-requested') changesRequested.push(event.code);
      if (event.status === 'blocked') blocked.push(event.code);
    }
    if (event.kind === 'message.done') steps += 1;
  });

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const state = await readState(input.projectId).catch(() => null);
      if (!state) break;

      if (state.paused) {
        paused = true;
        reason = `project paused during ${input.reason}`;
        break;
      }

      const budget = await enforceBudgets(input.projectId);
      if (!budget.ok) {
        paused = true;
        reason = `budget exhausted (${budget.reason})`;
        break;
      }

      if (state.phase !== input.waitForPhase) break;

      if (
        input.waitForPhase === 'IMPLEMENT' &&
        !(await hasImplementWork(input.projectId)) &&
        !hasLivePhaseTasks(input.projectId, input.waitForPhase) &&
        !hasBusyWorkerForPhase(house, input.waitForPhase)
      ) {
        // supervisor will pick up the idle buffer; wait for it to happen so
        // the HTTP caller sees the phase actually flip.
      }

      await sleep(getSupervisorTickMs());
    }
  } finally {
    stopListener();
  }

  const phaseStillHere = await isStillInPhase(input.projectId, input.waitForPhase);
  if (phaseStillHere && !paused) {
    reason ??= `timeout waiting for ${input.waitForPhase} to finish`;
  }

  return {
    completed,
    changesRequested,
    blocked,
    paused,
    reason,
    steps,
  };
}

async function hasImplementWork(projectId: string): Promise<boolean> {
  const index = await readTicketsIndex(projectId);
  if (!index) return false;
  return index.tickets.some(
    (ticket) =>
      ticket.status === 'todo' ||
      ticket.status === 'changes-requested' ||
      ticket.status === 'review' ||
      ticket.status === 'in-progress',
  );
}

function hasLivePhaseTasks(projectId: string, phase: Phase): boolean {
  return (
    listBacklog(projectId, { phase, statuses: ['pending', 'in-progress'] }).length > 0
  );
}

function hasBusyWorkerForPhase(house: SoftwareHouse, phase: Phase): boolean {
  const roles = new Set<RoleKey>(PHASE_PRIMARY_ROLES[phase]);
  for (const worker of house.workers.values()) {
    if (worker.state === 'working' && roles.has(worker.role)) return true;
  }
  return false;
}

async function isStillInPhase(projectId: string, phase: Phase): Promise<boolean> {
  const state = await readState(projectId).catch(() => null);
  return state?.phase === phase;
}

type WorkerSnapshot = {
  id: string;
  role: RoleKey;
  state: WorkerState;
  currentTaskId: string | null;
  currentTaskSlug: string | null;
  pollMs: number;
};

// debug helper — lets routes/UI introspect what the house is doing right now.
export function snapshotSoftwareHouse(projectId: string): {
  running: boolean;
  workers: WorkerSnapshot[];
  backlog: BacklogTask[];
  awaitingHumanForPhase: Phase | null;
  phaseIdleSinceMs: number | null;
} {
  const house = getStore().get(projectId);
  if (!house) {
    return {
      running: false,
      workers: [],
      backlog: listBacklog(projectId),
      awaitingHumanForPhase: null,
      phaseIdleSinceMs: null,
    };
  }

  return {
    running: true,
    workers: [...house.workers.values()].map((worker) => ({
      id: worker.id,
      role: worker.role,
      state: worker.state,
      currentTaskId: worker.currentTaskId,
      currentTaskSlug: worker.currentTaskSlug,
      pollMs: worker.pollMs,
    })),
    backlog: listBacklog(projectId),
    awaitingHumanForPhase: house.awaitingHumanForPhase,
    phaseIdleSinceMs: house.phaseIdleSinceMs,
  };
}

export { PIPELINE_PHASES };
