import { describe, expect, it } from 'vitest';
import { normaliseJsonLike, stripJsonPayload, tolerantJsonParse } from './tolerant-json';

describe('stripJsonPayload', () => {
  it('returns null for empty input', () => {
    expect(stripJsonPayload('')).toBeNull();
    expect(stripJsonPayload('   \n')).toBeNull();
  });

  it('pulls body out of ``` fences', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(stripJsonPayload(raw)).toBe('{"a":1}');
  });

  it('extracts a balanced object surrounded by prose', () => {
    const raw = 'prefix before {"a":{"nested":true},"b":2} trailing prose';
    expect(stripJsonPayload(raw)).toBe('{"a":{"nested":true},"b":2}');
  });

  it('returns null when nothing looks like an object', () => {
    expect(stripJsonPayload('just prose')).toBeNull();
  });
});

describe('normaliseJsonLike', () => {
  it('quotes unquoted object keys', () => {
    const input = '{ foo: 1, bar_baz: 2 }';
    const output = normaliseJsonLike(input);
    expect(JSON.parse(output)).toEqual({ foo: 1, bar_baz: 2 });
  });

  it('removes trailing commas', () => {
    const input = '{"a":1,"b":[1,2,],}';
    const output = normaliseJsonLike(input);
    expect(JSON.parse(output)).toEqual({ a: 1, b: [1, 2] });
  });

  it('converts single-quoted strings to double-quoted', () => {
    const input = `{ 'greeting': 'hello "there"' }`;
    const output = normaliseJsonLike(input);
    expect(JSON.parse(output)).toEqual({ greeting: 'hello "there"' });
  });
});

describe('tolerantJsonParse', () => {
  it('parses strict JSON', () => {
    const result = tolerantJsonParse('{"a":1}');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('parses LLM-style JS object literals', () => {
    const result = tolerantJsonParse(`{ text: "ok", blocks: [{ kind: "artifact" }], advance: false, }`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        text: 'ok',
        blocks: [{ kind: 'artifact' }],
        advance: false,
      });
    }
  });

  it('fails cleanly for input without any object', () => {
    expect(tolerantJsonParse('nothing here')).toEqual({ ok: false });
  });
});
