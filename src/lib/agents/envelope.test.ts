import { describe, expect, it } from 'vitest';
import { parseEnvelope, safePath, validateDevEnvelope } from './envelope';

describe('parseEnvelope', () => {
  it('parses a well-formed JSON envelope', () => {
    const raw = JSON.stringify({
      text: 'hello',
      blocks: [],
      writes: [{ path: 'SPEC.md', content: '# hello' }],
      sourceWrites: [],
      advance: true,
    });
    const env = parseEnvelope(raw);
    expect(env.text).toBe('hello');
    expect(env.writes).toHaveLength(1);
    expect(env.advance).toBe(true);
  });

  it('tolerates JSON wrapped in ``` fences', () => {
    const raw = '```json\n' + JSON.stringify({ text: 'ok', blocks: [], writes: [], sourceWrites: [], advance: false }) + '\n```';
    const env = parseEnvelope(raw);
    expect(env.text).toBe('ok');
  });

  it('flags a parse error when raw is not JSON', () => {
    const env = parseEnvelope('hello there, not JSON');
    expect(env.writes).toEqual([]);
    expect(env.sourceWrites).toEqual([]);
    expect(env.advance).toBe(false);
    expect(env.text).toBe('');
    expect(env.parseError).toBeDefined();
  });

  it('tolerates JS-style unquoted keys and trailing commas', () => {
    const raw = `{
      text: "Created SPEC.md",
      blocks: [
        { kind: "artifact", title: "SPEC.md", path: ".software-house/SPEC.md", artifactKind: "spec", phase: "SPEC", role: "pm", status: "review-requested", excerpt: "summary" },
      ],
      writes: [],
      sourceWrites: [],
      advance: false,
    }`;
    const env = parseEnvelope(raw);
    expect(env.parseError).toBeUndefined();
    expect(env.text).toBe('Created SPEC.md');
    expect(env.blocks).toHaveLength(1);
    expect(env.blocks[0]?.kind).toBe('artifact');
  });

  it('tolerates single-quoted strings', () => {
    const raw = `{ 'text': 'hello', 'blocks': [], 'writes': [], 'sourceWrites': [], 'advance': false }`;
    const env = parseEnvelope(raw);
    expect(env.parseError).toBeUndefined();
    expect(env.text).toBe('hello');
  });

  it('extracts JSON even with prose preamble', () => {
    const raw = `Sure! Here is the envelope:\n{"text":"ok","blocks":[],"writes":[],"sourceWrites":[],"advance":false}\nLet me know!`;
    const env = parseEnvelope(raw);
    expect(env.parseError).toBeUndefined();
    expect(env.text).toBe('ok');
  });

  it('fills defaults when JSON has missing fields', () => {
    const env = parseEnvelope(JSON.stringify({ whatever: true }));
    expect(env.writes).toEqual([]);
    expect(env.advance).toBe(false);
    expect(env.text).toBe('');
    expect(env.parseError).toBeUndefined();
  });

  it('accepts null for optional fields (ticketCode, review, etc.)', () => {
    const raw = JSON.stringify({
      text: 'ok',
      blocks: [],
      writes: [],
      sourceWrites: null,
      review: null,
      ticketCode: null,
      advance: true,
    });
    const env = parseEnvelope(raw);
    expect(env.parseError).toBeUndefined();
    expect(env.text).toBe('ok');
    expect(env.ticketCode).toBeUndefined();
    expect(env.review).toBeUndefined();
    expect(env.advance).toBe(true);
    expect(env.sourceWrites).toEqual([]);
  });

  it('salvages text, blocks and writes when schema validation fails on a sibling field', () => {
    const raw = JSON.stringify({
      text: 'planned',
      blocks: [
        {
          kind: 'ticket',
          code: 'T-0001',
          title: 'Do a thing',
          assigneeRole: 'backend-dev',
          dependsOn: [],
          status: 'todo',
        },
      ],
      writes: [{ path: 'PLAN.md', content: '# plan' }],
      advance: 'not-a-boolean',
    });
    const env = parseEnvelope(raw);
    expect(env.parseError).toBeDefined();
    expect(env.text).toBe('planned');
    expect(env.blocks).toHaveLength(1);
    expect(env.writes).toEqual([{ path: 'PLAN.md', content: '# plan' }]);
  });
});

describe('safePath', () => {
  it('strips leading slashes', () => {
    expect(safePath('/foo/bar.md')).toBe('foo/bar.md');
  });

  it('rejects .. traversal', () => {
    expect(safePath('../etc/passwd')).toBeNull();
    expect(safePath('foo/../../bar')).toBeNull();
  });

  it('rejects empty paths', () => {
    expect(safePath('')).toBeNull();
    expect(safePath('/')).toBeNull();
  });

  it('normalises backslashes', () => {
    expect(safePath('a\\b\\c.md')).toBe('a/b/c.md');
  });
});

describe('validateDevEnvelope', () => {
  it('flags a missing sourceWrites array', () => {
    const issues = validateDevEnvelope(
      {
        text: 'done',
        blocks: [],
        writes: [],
        sourceWrites: [],
        advance: true,
        droppedBlockCount: 0,
      },
      'backend-dev',
    );
    expect(issues[0]?.code).toBe('no-source-writes');
  });

  it('flags an empty-content write', () => {
    const issues = validateDevEnvelope(
      {
        text: 'done',
        blocks: [],
        writes: [],
        sourceWrites: [{ path: 'src/index.ts', content: '   \n\n' }],
        advance: true,
        droppedBlockCount: 0,
      },
      'backend-dev',
    );
    expect(issues.some((i) => i.code === 'empty-content')).toBe(true);
  });

  it('accepts devops vite scaffold sourceWrites', () => {
    const issues = validateDevEnvelope(
      {
        text: 'scaffold',
        blocks: [],
        writes: [],
        sourceWrites: [
          { path: 'package.json', content: '{}' },
          { path: 'vite.config.js', content: 'export default {}' },
          { path: 'src/main.js', content: '// entry' },
          { path: 'public/index.html', content: '<!doctype html>' },
          { path: 'tests/example.test.js', content: 'import { expect, test } from "vitest"; test("x", () => {});' },
        ],
        advance: false,
        droppedBlockCount: 0,
      },
      'devops',
    );
    expect(issues).toHaveLength(0);
  });
});
