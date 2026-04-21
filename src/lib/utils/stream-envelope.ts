const TEXT_KEY_PATTERN = /"text"\s*:\s*"/;

type StringRead = { text: string; complete: boolean };

export type StreamingBlockData =
  | {
      kind: "question";
      id?: string;
      question?: string;
      options?: Array<{ id?: string; label?: string; isDefault?: boolean }>;
      title?: never;
    }
  | {
      kind: string;
      id?: string;
      title?: string;
      path?: string;
      before?: string;
      after?: string;
      question?: never;
      options?: never;
    };

export type StreamingEnvelopePreview = {
  text: string;
  textComplete: boolean;
  blockCount: number;
  latestBlockKind: string | null;
  blocks: StreamingBlockData[];
  writeCount: number;
  latestWritePath: string | null;
  writes: Array<{ path: string }>;
  sourceWriteCount: number;
  latestSourceWritePath: string | null;
  sourceWrites: Array<{ path: string }>;
  hasReview: boolean;
  advance: boolean | null;
};

const EMPTY_PREVIEW: StreamingEnvelopePreview = {
  text: "",
  textComplete: false,
  blockCount: 0,
  latestBlockKind: null,
  blocks: [],
  writeCount: 0,
  latestWritePath: null,
  writes: [],
  sourceWriteCount: 0,
  latestSourceWritePath: null,
  sourceWrites: [],
  hasReview: false,
  advance: null,
};

// extracts the partially-streamed value of the top-level `"text"` field out
// of an envelope JSON string that may still be in the middle of streaming.
// returns an empty string before the field appears so callers can fall back
// to a placeholder.
export function extractStreamingEnvelopeText(raw: string): StringRead {
  const keyMatch = TEXT_KEY_PATTERN.exec(raw);
  if (!keyMatch) return { text: "", complete: false };
  const valueStart = keyMatch.index + keyMatch[0].length;
  return readJsonStringValue(raw, valueStart);
}

// scans a partial envelope stream and returns an overview of what the agent
// has drafted so far (text preview, block/write counts, review flag, etc).
// meant for driving status chips in the chat UI during streaming.
export function extractStreamingEnvelopePreview(
  raw: string,
): StreamingEnvelopePreview {
  if (!raw) return EMPTY_PREVIEW;

  const text = extractStreamingEnvelopeText(raw);
  const blocksScan = scanArrayOfObjects(raw, "blocks", "kind");
  const writesScan = scanArrayOfObjects(raw, "writes", "path");
  const sourceWritesScan = scanArrayOfObjects(raw, "sourceWrites", "path");
  const blocksData = extractAllBlocks(raw);
  const writesData = extractAllWrites(raw);
  const sourceWritesData = extractAllSourceWrites(raw);
  const review = findKeyIndex(raw, "review") !== -1;
  const advance = readBooleanField(raw, "advance");

  return {
    text: text.text,
    textComplete: text.complete,
    blockCount: blocksScan.count,
    latestBlockKind: blocksScan.latestPropertyValue,
    blocks: blocksData,
    writeCount: writesScan.count,
    latestWritePath: writesScan.latestPropertyValue,
    writes: writesData,
    sourceWriteCount: sourceWritesScan.count,
    latestSourceWritePath: sourceWritesScan.latestPropertyValue,
    sourceWrites: sourceWritesData,
    hasReview: review,
    advance,
  };
}

function readJsonStringValue(source: string, start: number): StringRead {
  let buffer = "";
  let index = start;

  while (index < source.length) {
    const char = source[index]!;

    if (char === "\\") {
      const next = source[index + 1];
      if (next === undefined) return { text: buffer, complete: false };
      buffer += decodeEscape(source, index);
      index += next === "u" ? 6 : 2;
      continue;
    }

    if (char === '"') return { text: buffer, complete: true };

    buffer += char;
    index += 1;
  }

  return { text: buffer, complete: false };
}

function decodeEscape(source: string, index: number): string {
  const next = source[index + 1];
  switch (next) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "/":
      return "/";
    case "u": {
      const hex = source.slice(index + 2, index + 6);
      if (hex.length < 4) return "";
      const code = Number.parseInt(hex, 16);
      return Number.isNaN(code) ? "" : String.fromCharCode(code);
    }
    default:
      return next ?? "";
  }
}

function findKeyIndex(raw: string, key: string): number {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:`);
  const match = pattern.exec(raw);
  return match ? match.index + match[0].length : -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ArrayScanResult = { count: number; latestPropertyValue: string | null };

// scans a streaming envelope for how many objects have started inside the
// named array, plus the latest value of an inner property (e.g. `kind` or
// `path`). only looks at the top-level depth within that array so it's
// safe while the stream is still incomplete.
function scanArrayOfObjects(
  raw: string,
  arrayKey: string,
  propertyKey: string,
): ArrayScanResult {
  const afterKey = findKeyIndex(raw, arrayKey);
  if (afterKey === -1) return { count: 0, latestPropertyValue: null };

  let cursor = afterKey;
  while (cursor < raw.length && raw[cursor] !== "[") {
    if (!/\s/.test(raw[cursor]!)) break;
    cursor += 1;
  }
  if (raw[cursor] !== "[") return { count: 0, latestPropertyValue: null };

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escape = false;
  let count = 0;
  let latestValue: string | null = null;

  for (let index = cursor; index < raw.length; index += 1) {
    const char = raw[index]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char as '"' | "'";
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (depth === 1 && char === "{") {
      count += 1;
      const read = readPropertyAtObjectStart(raw, index, propertyKey);
      if (read) latestValue = read;
    }
  }

  return { count, latestPropertyValue: latestValue };
}

function readPropertyAtObjectStart(
  source: string,
  objectStart: number,
  propertyKey: string,
): string | null {
  const slice = source.slice(objectStart);
  const pattern = new RegExp(`"${escapeRegExp(propertyKey)}"\\s*:\\s*"`);
  const match = pattern.exec(slice);
  if (!match) return null;
  const valueStart = objectStart + match.index + match[0].length;
  const read = readJsonStringValue(source, valueStart);
  return read.text || null;
}

function readBooleanField(raw: string, key: string): boolean | null {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*(true|false)\\b`);
  const match = pattern.exec(raw);
  if (!match) return null;
  return match[1] === "true";
}

// Extracts all blocks from the streaming envelope with their kind and title
function extractAllBlocks(raw: string): StreamingBlockData[] {
  const blocks: StreamingBlockData[] = [];
  const afterKey = findKeyIndex(raw, "blocks");
  if (afterKey === -1) return blocks;

  let cursor = afterKey;
  while (cursor < raw.length && raw[cursor] !== "[") {
    if (!/\s/.test(raw[cursor]!)) break;
    cursor += 1;
  }
  if (raw[cursor] !== "[") return blocks;

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escape = false;
  let objectStart = -1;

  for (let index = cursor; index < raw.length; index += 1) {
    const char = raw[index]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char as '"' | "'";
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (depth === 1 && char === "{") {
      objectStart = index;
      continue;
    }

    if (depth === 1 && char === "}" && objectStart !== -1) {
      const objectStr = raw.slice(objectStart, index + 1);
      const kind = extractJsonProperty(objectStr, "kind");

      if (kind === "question") {
        const id = extractJsonProperty(objectStr, "id");
        const question = extractJsonProperty(objectStr, "question");
        const optionsStr = extractJsonArrayProperty(objectStr, "options");
        const options = optionsStr
          ? optionsStr.map((opt) => ({
              id: opt.id || undefined,
              label: opt.label || undefined,
              isDefault: opt.isDefault,
            }))
          : undefined;
        blocks.push({
          kind: "question",
          id: id || undefined,
          question: question || undefined,
          options,
        });
      } else if (kind) {
        const title = extractJsonProperty(objectStr, "title");
        const path = extractJsonProperty(objectStr, "path");
        if (kind === "diff") {
          const before = extractJsonProperty(objectStr, "before");
          const after = extractJsonProperty(objectStr, "after");
          blocks.push({
            kind: "diff",
            title: title || undefined,
            path: path || undefined,
            before: before ?? undefined,
            after: after ?? undefined,
          });
        } else {
          blocks.push({
            kind,
            title: title || undefined,
            path: path || undefined,
          });
        }
      }
      objectStart = -1;
    }
  }

  return blocks;
}

// Extracts all writes from the streaming envelope with their path
function extractAllWrites(raw: string): Array<{ path: string }> {
  const writes: Array<{ path: string }> = [];
  const afterKey = findKeyIndex(raw, "writes");
  if (afterKey === -1) return writes;

  let cursor = afterKey;
  while (cursor < raw.length && raw[cursor] !== "[") {
    if (!/\s/.test(raw[cursor]!)) break;
    cursor += 1;
  }
  if (raw[cursor] !== "[") return writes;

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escape = false;
  let objectStart = -1;

  for (let index = cursor; index < raw.length; index += 1) {
    const char = raw[index]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char as '"' | "'";
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (depth === 1 && char === "{") {
      objectStart = index;
      continue;
    }

    if (depth === 1 && char === "}" && objectStart !== -1) {
      const objectStr = raw.slice(objectStart, index + 1);
      const path = extractJsonProperty(objectStr, "path");
      if (path) {
        writes.push({ path });
      }
      objectStart = -1;
    }
  }

  return writes;
}

// Extracts all source writes from the streaming envelope with their path
function extractAllSourceWrites(raw: string): Array<{ path: string }> {
  const sourceWrites: Array<{ path: string }> = [];
  const afterKey = findKeyIndex(raw, "sourceWrites");
  if (afterKey === -1) return sourceWrites;

  let cursor = afterKey;
  while (cursor < raw.length && raw[cursor] !== "[") {
    if (!/\s/.test(raw[cursor]!)) break;
    cursor += 1;
  }
  if (raw[cursor] !== "[") return sourceWrites;

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escape = false;
  let objectStart = -1;

  for (let index = cursor; index < raw.length; index += 1) {
    const char = raw[index]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char as '"' | "'";
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (depth === 1 && char === "{") {
      objectStart = index;
      continue;
    }

    if (depth === 1 && char === "}" && objectStart !== -1) {
      const objectStr = raw.slice(objectStart, index + 1);
      const path = extractJsonProperty(objectStr, "path");
      if (path) {
        sourceWrites.push({ path });
      }
      objectStart = -1;
    }
  }

  return sourceWrites;
}

// latest `sourceWrites[]` entry while the model streams JSON; drives the AI Code tab
export function extractStreamingLatestSourceWrite(raw: string): {
  path: string | null;
  pathComplete: boolean;
  content: string;
  contentComplete: boolean;
} {
  const empty = {
    path: null as string | null,
    pathComplete: false,
    content: '',
    contentComplete: false,
  };
  if (!raw.trim()) return empty;

  const afterKey = findKeyIndex(raw, 'sourceWrites');
  if (afterKey === -1) return empty;

  let cursor = afterKey;
  while (cursor < raw.length && raw[cursor] !== '[') {
    if (!/\s/.test(raw[cursor]!)) break;
    cursor += 1;
  }
  if (raw[cursor] !== '[') return empty;

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escape = false;
  let currentObjectStart = -1;
  let lastClosedSlice: string | null = null;

  for (let index = cursor; index < raw.length; index += 1) {
    const char = raw[index]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char as '"' | "'";
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (depth === 1 && char === '{') {
      currentObjectStart = index;
      continue;
    }

    if (depth === 1 && char === '}' && currentObjectStart !== -1) {
      lastClosedSlice = raw.slice(currentObjectStart, index + 1);
      currentObjectStart = -1;
      continue;
    }
  }

  const objectSlice =
    currentObjectStart >= 0 ? raw.slice(currentObjectStart) : lastClosedSlice;

  if (!objectSlice) return empty;

  const pathPattern = /"path"\s*:\s*"/;
  const pathMatch = pathPattern.exec(objectSlice);
  let path: string | null = null;
  let pathComplete = false;
  if (pathMatch) {
    const valueStart = pathMatch.index + pathMatch[0].length;
    const pathRead = readJsonStringValue(objectSlice, valueStart);
    path = pathRead.text || null;
    pathComplete = pathRead.complete;
  }

  const contentPattern = /"content"\s*:\s*"/;
  const contentMatch = contentPattern.exec(objectSlice);
  if (!contentMatch) {
    return { path, pathComplete, content: '', contentComplete: false };
  }
  const contentValueStart = contentMatch.index + contentMatch[0].length;
  const contentRead = readJsonStringValue(objectSlice, contentValueStart);
  return {
    path,
    pathComplete,
    content: contentRead.text,
    contentComplete: contentRead.complete,
  };
}

// Helper function to extract a string property value from a JSON object string
function extractJsonProperty(
  jsonStr: string,
  propertyKey: string,
): string | null {
  const pattern = new RegExp(`"${escapeRegExp(propertyKey)}"\\s*:\\s*"`);
  const match = pattern.exec(jsonStr);
  if (!match) return null;
  const valueStart = match.index + match[0].length;
  const read = readJsonStringValue(jsonStr, valueStart);
  return read.text;
}

// Helper function to extract an array of objects from a JSON string
function extractJsonArrayProperty(
  jsonStr: string,
  propertyKey: string,
): Array<{ id?: string; label?: string; isDefault?: boolean }> | null {
  const pattern = new RegExp(`"${escapeRegExp(propertyKey)}"\\s*:\\s*\\[`);
  const match = pattern.exec(jsonStr);
  if (!match) return null;

  const array: Array<{ id?: string; label?: string; isDefault?: boolean }> = [];
  let cursor = match.index + match[0].length;
  let depth = 1;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escape = false;
  let objectStart = -1;

  while (cursor < jsonStr.length && depth > 0) {
    const char = jsonStr[cursor]!;

    if (escape) {
      escape = false;
      cursor += 1;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escape = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      cursor += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char as '"' | "'";
      cursor += 1;
      continue;
    }

    if (char === "[") {
      depth += 1;
      cursor += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) break;
      cursor += 1;
      continue;
    }

    if (char === "{") {
      objectStart = cursor;
      cursor += 1;
      continue;
    }

    if (char === "}" && objectStart !== -1) {
      const objectStr = jsonStr.slice(objectStart, cursor + 1);
      const id = extractJsonProperty(objectStr, "id");
      const label = extractJsonProperty(objectStr, "label");
      const isDefaultStr = jsonStr.slice(objectStart, cursor + 1);
      const isDefaultMatch = /"isDefault"\s*:\s*(true|false)/.exec(
        isDefaultStr,
      );
      array.push({
        id: id || undefined,
        label: label || undefined,
        isDefault: isDefaultMatch ? isDefaultMatch[1] === "true" : undefined,
      });
      objectStart = -1;
    }

    cursor += 1;
  }

  return array.length > 0 ? array : null;
}
