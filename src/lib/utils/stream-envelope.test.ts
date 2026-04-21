import { describe, expect, it } from "vitest";
import {
  extractStreamingEnvelopePreview,
  extractStreamingEnvelopeText,
  extractStreamingLatestSourceWrite,
} from "./stream-envelope";

describe("extractStreamingEnvelopeText", () => {
  it("returns empty before the text key appears", () => {
    expect(extractStreamingEnvelopeText('{"bl')).toEqual({
      text: "",
      complete: false,
    });
    expect(extractStreamingEnvelopeText("")).toEqual({
      text: "",
      complete: false,
    });
  });

  it("returns empty when the text key exists but value has not opened yet", () => {
    expect(extractStreamingEnvelopeText('{"text"')).toEqual({
      text: "",
      complete: false,
    });
    expect(extractStreamingEnvelopeText('{"text":')).toEqual({
      text: "",
      complete: false,
    });
  });

  it("streams partial value while incomplete", () => {
    expect(extractStreamingEnvelopeText('{"text":"Hello wor')).toEqual({
      text: "Hello wor",
      complete: false,
    });
  });

  it("closes the value when the end quote arrives", () => {
    expect(
      extractStreamingEnvelopeText('{"text":"Hello","blocks":[]}'),
    ).toEqual({
      text: "Hello",
      complete: true,
    });
  });

  it("decodes common escape sequences", () => {
    const result = extractStreamingEnvelopeText(
      '{"text":"line1\\nline2 \\"quoted\\" \\\\end","',
    );
    expect(result).toEqual({
      text: 'line1\nline2 "quoted" \\end',
      complete: true,
    });
  });

  it("decodes unicode escapes", () => {
    expect(extractStreamingEnvelopeText('{"text":"caf\\u00e9"}')).toEqual({
      text: "café",
      complete: true,
    });
  });

  it("does not treat an unfinished escape as complete", () => {
    expect(extractStreamingEnvelopeText('{"text":"hello\\')).toEqual({
      text: "hello",
      complete: false,
    });
  });
});

describe("extractStreamingEnvelopePreview", () => {
  it("returns empty preview for empty input", () => {
    const preview = extractStreamingEnvelopePreview("");
    expect(preview.text).toBe("");
    expect(preview.blockCount).toBe(0);
    expect(preview.writeCount).toBe(0);
    expect(preview.hasReview).toBe(false);
    expect(preview.advance).toBeNull();
  });

  it("counts blocks as they start streaming and captures latest kind", () => {
    const raw =
      '{"text":"hi","blocks":[{"kind":"artifact","title":"SPEC.md"},{"kind":"question"';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.text).toBe("hi");
    expect(preview.blockCount).toBe(2);
    expect(preview.latestBlockKind).toBe("question");
  });

  it("counts writes and tracks the latest path", () => {
    const raw =
      '{"writes":[{"path":"SPEC.md","content":"..."},{"path":"ARCHITECTURE.md"';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.writeCount).toBe(2);
    expect(preview.latestWritePath).toBe("ARCHITECTURE.md");
  });

  it("detects review presence and advance flag", () => {
    const raw =
      '{"advance":true,"review":{"decision":"approve","evidence":[]}}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.hasReview).toBe(true);
    expect(preview.advance).toBe(true);
  });

  it("extracts all blocks with kind and title", () => {
    const raw =
      '{"text":"hi","blocks":[{"kind":"artifact","title":"SPEC.md"},{"kind":"question","id":"q1","question":"Q1?","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.blocks).toHaveLength(2);
    expect(preview.blocks[0]).toEqual({
      kind: "artifact",
      title: "SPEC.md",
      path: undefined,
    });
    expect(preview.blocks[1]).toEqual({
      kind: "question",
      id: "q1",
      question: "Q1?",
      options: [
        { id: "a", label: "A", isDefault: undefined },
        { id: "b", label: "B", isDefault: undefined },
      ],
    });
  });

  it("extracts blocks without title", () => {
    const raw = '{"blocks":[{"kind":"gate"},{"kind":"artifact"}]}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.blocks).toHaveLength(2);
    expect(preview.blocks[0]).toEqual({ kind: "gate", path: undefined });
    expect(preview.blocks[1]).toEqual({
      kind: "artifact",
      path: undefined,
    });
  });

  it("extracts all writes with path", () => {
    const raw =
      '{"writes":[{"path":"SPEC.md","content":"..."},{"path":"ARCHITECTURE.md","content":"..."}]}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.writes).toHaveLength(2);
    expect(preview.writes[0]).toEqual({ path: "SPEC.md" });
    expect(preview.writes[1]).toEqual({ path: "ARCHITECTURE.md" });
  });

  it("extracts all source writes with path", () => {
    const raw =
      '{"sourceWrites":[{"path":"src/index.ts","content":"..."},{"path":"src/app.ts","content":"..."}]}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.sourceWrites).toHaveLength(2);
    expect(preview.sourceWrites[0]).toEqual({ path: "src/index.ts" });
    expect(preview.sourceWrites[1]).toEqual({ path: "src/app.ts" });
  });

  it("returns empty arrays when no blocks, writes, or sourceWrites", () => {
    const raw = '{"text":"hello","blocks":[],"writes":[],"sourceWrites":[]}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.blocks).toEqual([]);
    expect(preview.writes).toEqual([]);
    expect(preview.sourceWrites).toEqual([]);
  });

  it("extracts blocks during partial streaming", () => {
    const raw =
      '{"text":"hi","blocks":[{"kind":"artifact","title":"SPEC.md"},{"kind":"';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.blocks).toHaveLength(1);
    expect(preview.blocks[0]).toEqual({
      kind: "artifact",
      title: "SPEC.md",
      path: undefined,
    });
  });

  it("extracts path on diff and artifact blocks for chip labels", () => {
    const raw =
      '{"blocks":[{"kind":"diff","path":"src/a.ts","before":"","after":"x"},{"kind":"artifact","title":"Note","path":"notes/x.md"}]}';
    const preview = extractStreamingEnvelopePreview(raw);
    expect(preview.blocks).toEqual([
      {
        kind: "diff",
        title: undefined,
        path: "src/a.ts",
        before: "",
        after: "x",
      },
      { kind: "artifact", title: "Note", path: "notes/x.md" },
    ]);
  });
});

describe("extractStreamingLatestSourceWrite", () => {
  it("returns empty when sourceWrites is missing", () => {
    expect(extractStreamingLatestSourceWrite('{"text":"x"}')).toEqual({
      path: null,
      pathComplete: false,
      content: "",
      contentComplete: false,
    });
  });

  it("streams path and partial content from an incomplete last object", () => {
    const raw =
      '{"sourceWrites":[{"path":"src/a.tsx","content":"export default function Page() {\\n  retur';
    const got = extractStreamingLatestSourceWrite(raw);
    expect(got.path).toBe("src/a.tsx");
    expect(got.pathComplete).toBe(true);
    expect(got.content).toBe("export default function Page() {\n  retur");
    expect(got.contentComplete).toBe(false);
  });

  it("reads a fully closed last source write", () => {
    const raw = '{"sourceWrites":[{"path":"src/old.ts","content":"// x"}]}';
    const got = extractStreamingLatestSourceWrite(raw);
    expect(got.path).toBe("src/old.ts");
    expect(got.content).toBe("// x");
    expect(got.contentComplete).toBe(true);
  });
});
