// canned agent envelopes used by the mock provider so `pnpm demo` can
// exercise the full pipeline end-to-end without an API key. each builder
// returns a JSON string in the exact shape the envelope parser expects —
// `agentEnvelopeSchema.parse` should succeed in every case. the catalog is
// deliberately minimal (one ticket, zero clarifications, no QA failures)
// so a smoke run finishes in a handful of seconds.

import type { Phase } from '@/lib/const/phases';
import type { RoleKey } from '@/lib/const/roles';

type EnvelopeContext = {
  phase: Phase;
  role: RoleKey;
  projectName: string;
  slug: string;
  userPrompt: string;
};

const NOW = () => new Date().toISOString();

// parses "You are implementing ticket T-0001: Build the login form"
// (or the reviewer variant) back into its code + title.
export function extractTicketRef(userPrompt: string): { code: string; title: string } | null {
  const match = userPrompt.match(/ticket\s+(T-\d{4})[:\s]+([^\n.]+)/i);
  if (!match) return null;
  return { code: match[1]!, title: match[2]!.trim() };
}

type EnvelopeBuilder = (ctx: EnvelopeContext) => unknown;

// role × phase → envelope. missing entries fall through to the safe default.
export function pickEnvelope(ctx: EnvelopeContext): string {
  const key = `${ctx.role}:${ctx.phase}` as const;
  const builder = BUILDERS[key] ?? DEFAULT_BUILDER;
  return JSON.stringify(builder(ctx));
}

const BUILDERS: Record<string, EnvelopeBuilder> = {
  'orchestrator:INTAKE': intakeEnvelope,
  'orchestrator:CLARIFY': clarifyEnvelope,
  'pm:SPEC': specEnvelope,
  'architect:ARCHITECT': architectEnvelope,
  'techlead:PLAN': planEnvelope,
  'backend-dev:IMPLEMENT': devEnvelope,
  'frontend-dev:IMPLEMENT': devEnvelope,
  'devops:IMPLEMENT': devEnvelope,
  'reviewer:IMPLEMENT': reviewerEnvelope,
  'devops:BRINGUP': bringupEnvelope,
  'qa:QA_MANUAL': qaEnvelope,
  'incident:SELF_HEAL': incidentEnvelope,
  'security:SECURITY': securityEnvelope,
  'release:RELEASE': releaseEnvelope,
  'writer:DEMO': demoEnvelope,
};

const DEFAULT_BUILDER: EnvelopeBuilder = (ctx) => ({
  text: `[mock] no canned envelope for ${ctx.role} in ${ctx.phase}. advance=false so the driver stops.`,
  blocks: [],
  writes: [],
  sourceWrites: [],
  advance: false,
});

function intakeEnvelope(ctx: EnvelopeContext) {
  const body = [
    `---`,
    `role: orchestrator`,
    `phase: INTAKE`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# ${ctx.projectName} — Requirements`,
    ``,
    `## Raw requirement`,
    ``,
    ctx.userPrompt.slice(0, 500),
    ``,
    `## Assumptions`,
    `- No authentication required`,
    `- No backend / database — single page`,
    `- Deployed as static files`,
    ``,
    `## Clarifications`,
    `- (none — mock provider auto-accepted defaults)`,
  ].join('\n');

  return {
    text: '[mock] captured the requirement and filled in sensible defaults. moving on to SPEC.',
    blocks: [
      {
        kind: 'artifact',
        title: 'REQUIREMENTS.md',
        path: '.software-house/REQUIREMENTS.md',
        artifactKind: 'requirements',
        phase: 'INTAKE',
        role: 'orchestrator',
        status: 'accepted',
        excerpt: 'captured raw requirement, filled defaults for auth + storage.',
      },
      {
        kind: 'gate',
        fromPhase: 'INTAKE',
        toPhase: 'CLARIFY',
        decision: 'pending',
        checks: [{ label: 'requirement captured', ok: true }],
      },
    ],
    writes: [{ path: 'REQUIREMENTS.md', content: body }],
    sourceWrites: [],
    advance: true,
  };
}

function clarifyEnvelope(_ctx: EnvelopeContext) {
  return {
    text: '[mock] no open clarifications. advancing to SPEC.',
    blocks: [
      {
        kind: 'gate',
        fromPhase: 'CLARIFY',
        toPhase: 'SPEC',
        decision: 'pending',
        checks: [{ label: 'no open questions', ok: true }],
      },
    ],
    writes: [],
    sourceWrites: [],
    advance: true,
  };
}

function specEnvelope(ctx: EnvelopeContext) {
  const body = [
    `---`,
    `role: pm`,
    `phase: SPEC`,
    `timestamp: ${NOW()}`,
    `status: review-requested`,
    `---`,
    ``,
    `# ${ctx.projectName} — SPEC`,
    ``,
    `## Overview`,
    `${ctx.projectName} is a single-page static site.`,
    ``,
    `## Personas`,
    `- Visitor: reads the landing page.`,
    ``,
    `## User stories`,
    ``,
    `### As a visitor, I can see the project title and description`,
    `- The heading renders "Hello, Olympus".`,
    `- A paragraph describes the project in <= 300 characters.`,
    ``,
    `### As a visitor, I can navigate to the README`,
    `- A link labelled "README" is visible on the page.`,
    `- Clicking the link opens the README in a new tab.`,
    ``,
    `## Non-goals`,
    `- Authentication, persistence, analytics.`,
    ``,
    `## Open questions`,
    `- (none)`,
  ].join('\n');

  return {
    text: '[mock] drafted SPEC.md with 2 user stories and 2 acceptance criteria each.',
    blocks: [
      {
        kind: 'artifact',
        title: 'SPEC.md',
        path: '.software-house/SPEC.md',
        artifactKind: 'spec',
        phase: 'SPEC',
        role: 'pm',
        status: 'review-requested',
        excerpt: 'one-sentence summary of a two-story spec.',
      },
      {
        kind: 'gate',
        fromPhase: 'SPEC',
        toPhase: 'ARCHITECT',
        decision: 'pending',
        checks: [
          { label: 'front-matter correct', ok: true },
          { label: 'every story has >= 2 ACs', ok: true },
          { label: 'non-goals non-empty', ok: true },
        ],
      },
    ],
    writes: [{ path: 'SPEC.md', content: body }],
    sourceWrites: [],
    advance: true,
  };
}

function architectEnvelope(ctx: EnvelopeContext) {
  const architecture = [
    `---`,
    `role: architect`,
    `phase: ARCHITECT`,
    `timestamp: ${NOW()}`,
    `status: review-requested`,
    `---`,
    ``,
    `# ${ctx.projectName} — Architecture`,
    ``,
    `## Overview`,
    `Static Next.js app served from \`public/\`. No backend, no database.`,
    ``,
    `## Components`,
    ``,
    `| Component | Responsibility | Tech |`,
    `| --- | --- | --- |`,
    `| \`page\` | renders heading + description + README link | Next.js + React |`,
    ``,
    `## Data model`,
    `- None.`,
    ``,
    `## Sequence`,
    ``,
    `\`\`\`mermaid`,
    `sequenceDiagram`,
    `  Visitor->>App: GET /`,
    `  App-->>Visitor: 200 OK (HTML)`,
    `\`\`\``,
    ``,
    `## Open questions`,
    `- (none)`,
  ].join('\n');

  const adr = [
    `---`,
    `role: architect`,
    `phase: ARCHITECT`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# ADR-0001 — Static Next.js site`,
    ``,
    `## Context`,
    `${ctx.projectName} needs a single static page — no backend, no auth.`,
    ``,
    `## Decision`,
    `Use Next.js App Router, export statically at build time.`,
    ``,
    `## Consequences`,
    `- No server runtime required.`,
    `- Zero backend surface area for security review.`,
  ].join('\n');

  return {
    text: '[mock] drafted ARCHITECTURE.md + ADR-0001.',
    blocks: [
      {
        kind: 'artifact',
        title: 'ARCHITECTURE.md',
        path: '.software-house/ARCHITECTURE.md',
        artifactKind: 'architecture',
        phase: 'ARCHITECT',
        role: 'architect',
        status: 'review-requested',
        excerpt: 'static next.js site',
      },
      {
        kind: 'artifact',
        title: 'ADR-0001-static-next.md',
        path: '.software-house/adr/ADR-0001-static-next.md',
        artifactKind: 'adr',
        phase: 'ARCHITECT',
        role: 'architect',
        status: 'accepted',
        excerpt: 'decision: static next.js',
      },
      {
        kind: 'gate',
        fromPhase: 'ARCHITECT',
        toPhase: 'PLAN',
        decision: 'pending',
        checks: [{ label: 'at least one ADR', ok: true }],
      },
    ],
    writes: [
      { path: 'ARCHITECTURE.md', content: architecture },
      { path: 'adr/ADR-0001-static-next.md', content: adr },
    ],
    sourceWrites: [],
    advance: true,
  };
}

function planEnvelope(ctx: EnvelopeContext) {
  const planBody = [
    `---`,
    `role: techlead`,
    `phase: PLAN`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# ${ctx.projectName} — Plan`,
    ``,
    `\`\`\`mermaid`,
    `graph TD`,
    `  T1[T-0001: landing page]`,
    `\`\`\``,
    ``,
    `| Code | Title | Role | Depends on | Acceptance ref |`,
    `| --- | --- | --- | --- | --- |`,
    `| T-0001 | Landing page | frontend-dev | — | SPEC story 1 + 2 |`,
  ].join('\n');

  const ticketBody = [
    `---`,
    `role: techlead`,
    `phase: PLAN`,
    `ticket: T-0001`,
    `assignee: frontend-dev`,
    `depends_on: []`,
    `---`,
    ``,
    `# T-0001: Landing page`,
    ``,
    `## Scope`,
    `Render the heading, paragraph, and README link described in SPEC.md.`,
    ``,
    `## Acceptance`,
    `- \`src/app/page.tsx\` renders the expected content.`,
  ].join('\n');

  return {
    text: '[mock] sliced the plan into one ticket: T-0001 landing page.',
    blocks: [
      {
        kind: 'artifact',
        title: 'PLAN.md',
        path: '.software-house/PLAN.md',
        artifactKind: 'plan',
        phase: 'PLAN',
        role: 'techlead',
        status: 'accepted',
        excerpt: 'single-ticket plan',
      },
      {
        kind: 'ticket',
        code: 'T-0001',
        title: 'Landing page',
        assigneeRole: 'frontend-dev',
        dependsOn: [],
        status: 'todo',
      },
      {
        kind: 'gate',
        fromPhase: 'PLAN',
        toPhase: 'IMPLEMENT',
        decision: 'pending',
        checks: [{ label: 'at least one ticket', ok: true }],
      },
    ],
    writes: [
      { path: 'PLAN.md', content: planBody },
      { path: 'tickets/T-0001-landing-page.md', content: ticketBody },
    ],
    sourceWrites: [],
    advance: true,
  };
}

function devEnvelope(ctx: EnvelopeContext) {
  const ref = extractTicketRef(ctx.userPrompt) ?? { code: 'T-0001', title: 'Landing page' };
  const page = [
    `export default function Page() {`,
    `  return (`,
    `    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>`,
    `      <h1>Hello, Olympus</h1>`,
    `      <p>A placeholder landing page generated by the mock LLM provider.</p>`,
    `      <a href="/README.md" target="_blank" rel="noreferrer">README</a>`,
    `    </main>`,
    `  );`,
    `}`,
  ].join('\n');

  return {
    text: `[mock] implemented ${ref.code}: ${ref.title}. see diff block.`,
    blocks: [
      {
        kind: 'diff',
        path: 'src/app/page.tsx',
        before: '',
        after: page,
      },
    ],
    writes: [],
    sourceWrites: [{ path: 'src/app/page.tsx', content: page }],
    ticketCode: ref.code,
    advance: false,
  };
}

function reviewerEnvelope(ctx: EnvelopeContext) {
  const ref = extractTicketRef(ctx.userPrompt) ?? { code: 'T-0001', title: 'Landing page' };
  const reviewNote = [
    `---`,
    `role: reviewer`,
    `phase: IMPLEMENT`,
    `ticket: ${ref.code}`,
    `timestamp: ${NOW()}`,
    `status: approve`,
    `---`,
    ``,
    `# Review — ${ref.code}`,
    ``,
    `## Decision`,
    `approve`,
    ``,
    `## Evidence`,
    `- read src/app/page.tsx`,
    `- confirmed heading, paragraph, link render as specified`,
  ].join('\n');

  return {
    text: `[mock] reviewed ${ref.code}: approved.`,
    blocks: [],
    writes: [{ path: `reviews/PR-${ref.code}-review.md`, content: reviewNote }],
    sourceWrites: [],
    review: {
      decision: 'approve',
      findings: [],
      rerun: false,
      evidence: ['read src/app/page.tsx', 'confirmed spec mapping'],
    },
    ticketCode: ref.code,
    advance: false,
  };
}

function bringupEnvelope(_ctx: EnvelopeContext) {
  const bringupDoc = [
    `---`,
    `role: devops`,
    `phase: BRINGUP`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# Bring-up (local run for manual QA)`,
    ``,
    `- Infra/scripts were implemented and reviewed under IMPLEMENT tickets.`,
    `- Olympus runs \`pnpm run dev\` in the workspace, sets \`PORT\`, waits for HTTP 200, streams logs, and embeds the App / Runtime preview.`,
    `- Operator: use the AI Code / Runtime tab for manual UI testing; QA_MANUAL follows with the written test plan + Playwright smoke.`,
  ].join('\n');

  return {
    text: '[mock] BRINGUP.md — local server + manual QA readiness only (no new source writes).',
    blocks: [
      {
        kind: 'gate',
        fromPhase: 'BRINGUP',
        toPhase: 'QA_MANUAL',
        decision: 'pending',
        checks: [{ label: 'BRINGUP.md present', ok: true }],
      },
    ],
    writes: [{ path: 'BRINGUP.md', content: bringupDoc }],
    sourceWrites: [],
    advance: true,
  };
}

function qaEnvelope(_ctx: EnvelopeContext) {
  const plan = [
    `---`,
    `role: qa`,
    `phase: QA_MANUAL`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# QA Test Plan`,
    ``,
    `## Scenario 1 — landing page renders`,
    `- Preconditions: app running on :3200.`,
    `- Steps: navigate to /.`,
    `- Expected: heading "Hello, Olympus" is visible.`,
    `- Evidence: qa/screenshots/landing/step-01.png.`,
  ].join('\n');

  return {
    text: '[mock] drafted one QA scenario per SPEC story.',
    blocks: [
      {
        kind: 'artifact',
        title: 'test-plan.md',
        path: '.software-house/qa/test-plan.md',
        artifactKind: 'qa-plan',
        phase: 'QA_MANUAL',
        role: 'qa',
        status: 'accepted',
        excerpt: 'single scenario',
      },
      {
        kind: 'gate',
        fromPhase: 'QA_MANUAL',
        toPhase: 'SELF_HEAL',
        decision: 'pending',
        checks: [{ label: 'scenarios == stories', ok: true }],
      },
    ],
    writes: [{ path: 'qa/test-plan.md', content: plan }],
    sourceWrites: [],
    advance: true,
  };
}

function incidentEnvelope(_ctx: EnvelopeContext) {
  return {
    text: '[mock] no open incidents. advancing to SECURITY.',
    blocks: [
      {
        kind: 'gate',
        fromPhase: 'SELF_HEAL',
        toPhase: 'SECURITY',
        decision: 'pending',
        checks: [{ label: 'no open incidents', ok: true }],
      },
    ],
    writes: [],
    sourceWrites: [],
    advance: true,
  };
}

function securityEnvelope(_ctx: EnvelopeContext) {
  const review = [
    `---`,
    `role: security`,
    `phase: SECURITY`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# Security review`,
    ``,
    `## Dependencies`,
    `- No runtime deps beyond next/react. No known CVEs.`,
    ``,
    `## Secrets`,
    `- None committed.`,
    ``,
    `## Remediations`,
    `- (none) — static site, no attack surface.`,
  ].join('\n');

  return {
    text: '[mock] no high-severity findings.',
    blocks: [
      {
        kind: 'artifact',
        title: 'SECURITY_REVIEW.md',
        path: '.software-house/SECURITY_REVIEW.md',
        artifactKind: 'security-review',
        phase: 'SECURITY',
        role: 'security',
        status: 'accepted',
        excerpt: 'no high findings',
      },
      {
        kind: 'gate',
        fromPhase: 'SECURITY',
        toPhase: 'RELEASE',
        decision: 'pending',
        checks: [{ label: 'no open high findings', ok: true }],
      },
    ],
    writes: [{ path: 'SECURITY_REVIEW.md', content: review }],
    sourceWrites: [],
    advance: true,
  };
}

function releaseEnvelope(ctx: EnvelopeContext) {
  const changelog = [
    `---`,
    `role: release`,
    `phase: RELEASE`,
    `timestamp: ${NOW()}`,
    `status: accepted`,
    `---`,
    ``,
    `# Changelog`,
    ``,
    `## 0.1.0`,
    ``,
    `### Added`,
    `- T-0001 Landing page.`,
  ].join('\n');

  const demoMd = [
    `---`,
    `role: release`,
    `phase: RELEASE`,
    `timestamp: ${NOW()}`,
    `---`,
    ``,
    `# Demo script`,
    ``,
    `1. \`pnpm dev\``,
    `2. open \`/\`, show heading + paragraph + README link.`,
    `3. click the link, show README opens.`,
  ].join('\n');

  return {
    text: `[mock] cut 0.1.0 for ${ctx.projectName}.`,
    blocks: [
      {
        kind: 'gate',
        fromPhase: 'RELEASE',
        toPhase: 'DEMO',
        decision: 'pending',
        checks: [{ label: 'changelog present', ok: true }],
      },
    ],
    writes: [
      { path: 'CHANGELOG.md', content: changelog },
      { path: 'DEMO.md', content: demoMd },
    ],
    sourceWrites: [],
    advance: true,
  };
}

function demoEnvelope(ctx: EnvelopeContext) {
  const readme = [
    `# ${ctx.projectName}`,
    ``,
    `## Quickstart`,
    ``,
    `\`\`\`bash`,
    `pnpm install`,
    `pnpm dev`,
    `\`\`\``,
    ``,
    `## Features`,
    `- Landing page (SPEC stories 1 + 2).`,
    ``,
    `## Links`,
    `- [SPEC](./.software-house/SPEC.md)`,
    `- [CHANGELOG](./CHANGELOG.md)`,
    `- [DEMO](./DEMO.md)`,
  ].join('\n');

  return {
    text: '[mock] wrote the README.',
    blocks: [
      {
        kind: 'gate',
        fromPhase: 'DEMO',
        toPhase: 'DEMO',
        decision: 'pending',
        checks: [
          { label: 'all acceptance met', ok: true },
          { label: 'no open high findings', ok: true },
          { label: 'changelog + demo present', ok: true },
        ],
      },
    ],
    writes: [],
    sourceWrites: [{ path: 'README.md', content: readme }],
    advance: false,
  };
}
