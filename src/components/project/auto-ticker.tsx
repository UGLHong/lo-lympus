'use client';

import { useEffect, useRef } from 'react';
import type { ProjectViewState } from '@/lib/client/project-store';

type Props = {
  view: ProjectViewState;
};

// How often we check whether the loop needs a kick. The check itself is
// cheap (state lookup + a couple of predicates); the real rate-limiter is
// the staleness threshold below, which ensures we only POST when the
// workspace has actually gone quiet.
const POLL_INTERVAL_MS = 5_000;

// Minimum time since the last server-side event before we consider the
// project "idle" enough to warrant a re-kick. This has to be long enough
// that a still-running agent turn (dev/reviewer LLM call) doesn't look
// stale to us — typical turn latency is ~10–90s based on the trace in
// events.ndjson, so 30s is a conservative floor.
const IDLE_THRESHOLD_MS = 30_000;

// Minimum gap between autotick POSTs for a given project from *this* tab.
// Belt-and-braces on top of the server-side inFlight lock, since that
// lock only catches concurrent requests, not rapid serial ones.
const MIN_POST_GAP_MS = 15_000;

/**
 * Watches the project state and periodically POSTs /implement with
 * `autotick: true` when:
 *   - the project is in the IMPLEMENT phase,
 *   - it is not paused (HELP_NEEDED.md not pending a human),
 *   - the SSE connection is live, and
 *   - no server event has arrived within IDLE_THRESHOLD_MS.
 *
 * Renders nothing — this is a side-effect-only component intended to be
 * mounted once per project page.
 *
 * The server /implement route validates everything we check here and
 * short-circuits with `{ skipped: true }` if the conditions aren't met,
 * so this is purely an optimisation to avoid unnecessary POSTs.
 */
export function AutoTicker({ view }: Props) {
  const { projectId } = view.state;
  const phase = view.state.phase;
  const paused = view.state.paused;
  const lastEventTs = view.lastEventTs;
  const connected = view.connected;

  // Track the last POST time across renders without retriggering the
  // polling effect. Also track the last timestamp we saw, so we can detect
  // "an event arrived since my last tick" instead of only looking at
  // wall-clock age (which gets stale if the tab was backgrounded).
  const lastPostAtRef = useRef<number>(0);
  const latestViewRef = useRef({ phase, paused, lastEventTs, connected });

  useEffect(() => {
    latestViewRef.current = { phase, paused, lastEventTs, connected };
  }, [phase, paused, lastEventTs, connected]);

  useEffect(() => {
    let cancelled = false;

    async function maybeTick() {
      if (cancelled) return;

      const snapshot = latestViewRef.current;

      // Fast bail-outs: the server would skip these too, but it's cheap
      // (and polite) to avoid the round-trip entirely.
      if (snapshot.phase !== 'IMPLEMENT') return;
      if (snapshot.paused) return;
      if (!snapshot.connected) return;

      const now = Date.now();
      if (now - lastPostAtRef.current < MIN_POST_GAP_MS) return;

      // Determine idleness. If we've never seen an event (fresh tab load,
      // server just restarted), fall back to the time since the page mounted
      // by treating lastEventTs as "long ago".
      let lastEventMs: number;
      if (snapshot.lastEventTs) {
        const parsed = Date.parse(snapshot.lastEventTs);
        lastEventMs = Number.isFinite(parsed) ? parsed : 0;
      } else {
        lastEventMs = 0;
      }

      const idleMs = lastEventMs === 0 ? Infinity : now - lastEventMs;
      if (idleMs < IDLE_THRESHOLD_MS) return;

      lastPostAtRef.current = now;

      try {
        const response = await fetch(`/api/projects/${projectId}/implement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autotick: true }),
        });

        if (!response.ok) {
          // eslint-disable-next-line no-console
          console.warn(
            '[autoticker] /implement returned non-ok',
            response.status,
          );
          return;
        }

        const body = (await response.json().catch(() => null)) as
          | {
              ok: boolean;
              skipped?: boolean;
              reason?: string;
              summary?: { steps: number; completed: string[] };
              gate?: { ok: boolean; advanced: boolean };
            }
          | null;

        if (!body) return;

        if (body.skipped) {
          // If the server told us to back off for a structural reason (not
          // just "already running"), bump the throttle so we don't hammer
          // it. Transient reasons (empty index, no ready ticket) usually
          // resolve themselves quickly as the state advances.
          // eslint-disable-next-line no-console
          console.debug('[autoticker] skipped:', body.reason);
          return;
        }

        // A successful batch will have already emitted events over SSE,
        // which naturally bumps lastEventTs and pushes the next tick out.
        // eslint-disable-next-line no-console
        console.debug('[autoticker] ticked', {
          steps: body.summary?.steps,
          completed: body.summary?.completed?.length,
          advanced: body.gate?.advanced,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[autoticker] POST failed', err);
      }
    }

    const intervalId = window.setInterval(() => {
      void maybeTick();
    }, POLL_INTERVAL_MS);

    // Kick once shortly after mount so a page reload on an idle project
    // doesn't have to wait a full POLL_INTERVAL_MS for the first check.
    const kickoffId = window.setTimeout(() => {
      void maybeTick();
    }, 2_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.clearTimeout(kickoffId);
    };
  }, [projectId]);

  return null;
}
