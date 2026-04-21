import { describe, expect, it } from 'vitest';
import { PIPELINE_PHASES } from '@/lib/const/phases';
import { ROLE_KEYS } from '@/lib/const/roles';
import { parseEnvelope } from '@/lib/agents/envelope';
import { pickEnvelope, extractTicketRef } from './mock-envelopes';
import { createMockProvider } from './mock';

describe('mock provider — canned envelopes', () => {
  it('returns a parseable envelope for every (role, phase) combination', () => {
    for (const role of ROLE_KEYS) {
      for (const phase of PIPELINE_PHASES) {
        const raw = pickEnvelope({
          role,
          phase,
          projectName: 'Test Project',
          slug: 'test-project',
          userPrompt: `"phase": "${phase}"`,
        });
        const envelope = parseEnvelope(raw);
        expect(envelope, `${role} × ${phase}`).toBeDefined();
        expect(envelope.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('INTAKE → orchestrator writes REQUIREMENTS.md and advances', () => {
    const raw = pickEnvelope({
      role: 'orchestrator',
      phase: 'INTAKE',
      projectName: 'Demo',
      slug: 'demo',
      userPrompt: 'Build a simple page',
    });
    const envelope = parseEnvelope(raw);
    expect(envelope.advance).toBe(true);
    expect(envelope.writes.find((w) => w.path === 'REQUIREMENTS.md')).toBeDefined();
  });

  it('IMPLEMENT → backend-dev emits sourceWrites + ticketCode', () => {
    const raw = pickEnvelope({
      role: 'backend-dev',
      phase: 'IMPLEMENT',
      projectName: 'Demo',
      slug: 'demo',
      userPrompt: 'You are implementing ticket T-0042: Fancy Feature.',
    });
    const envelope = parseEnvelope(raw);
    expect(envelope.advance).toBe(false);
    expect(envelope.ticketCode).toBe('T-0042');
    expect(envelope.sourceWrites.length).toBeGreaterThan(0);
  });

  it('IMPLEMENT → reviewer emits an approve review with evidence', () => {
    const raw = pickEnvelope({
      role: 'reviewer',
      phase: 'IMPLEMENT',
      projectName: 'Demo',
      slug: 'demo',
      userPrompt: 'Review the implementation of ticket T-0007: Landing page.',
    });
    const envelope = parseEnvelope(raw);
    expect(envelope.review?.decision).toBe('approve');
    expect(envelope.review?.evidence.length).toBeGreaterThan(0);
  });

  it('DEMO → writer emits README.md via sourceWrites', () => {
    const raw = pickEnvelope({
      role: 'writer',
      phase: 'DEMO',
      projectName: 'Demo',
      slug: 'demo',
      userPrompt: '',
    });
    const envelope = parseEnvelope(raw);
    expect(envelope.sourceWrites.find((w) => w.path === 'README.md')).toBeDefined();
  });

  it('extractTicketRef pulls code + title from a dev-style prompt', () => {
    const ref = extractTicketRef('You are implementing ticket T-0123: Build the widget. Reasons…');
    expect(ref).toEqual({ code: 'T-0123', title: 'Build the widget' });
  });

  it('streamChat emits token, usage, and done chunks', async () => {
    const provider = createMockProvider();
    const chunks: string[] = [];
    let usageSeen = false;
    let doneSeen = false;

    for await (const chunk of provider.streamChat({
      model: 'mock',
      messages: [
        { role: 'system', content: '# Role: pm' },
        { role: 'user', content: '"phase": "SPEC"\n"name": "Demo"\n"slug": "demo"' },
      ],
    })) {
      if (chunk.kind === 'token') chunks.push(chunk.text);
      if (chunk.kind === 'usage') {
        usageSeen = true;
        expect(chunk.usage.totalTokens).toBeGreaterThan(0);
      }
      if (chunk.kind === 'done') doneSeen = true;
    }

    expect(chunks.join('')).toContain('SPEC');
    expect(usageSeen).toBe(true);
    expect(doneSeen).toBe(true);
  });
});
