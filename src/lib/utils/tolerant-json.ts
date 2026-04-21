type Parsed = { ok: true; value: unknown } | { ok: false };

// strips ``` / ```json fences and any prose that surrounds the JSON body.
// returns the trimmed candidate payload, or null if none was found.
export function stripJsonPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip constraint markers like <|constrain|>json, <|end|>, <|start|>assistant
  let source = trimmed.replace(/<\|[^|]*\|>/g, " ");

  source = stripOuterFence(source) ?? source;

  const firstObject = findBalancedObject(source);
  if (firstObject) return firstObject;

  if (source.startsWith("{") && source.endsWith("}")) return source;
  return null;
}

// only strips ``` fences when they wrap the ENTIRE payload; avoids
// matching backticks that appear inside a JSON string value (e.g.
// markdown bodies in `writes[].content`).
function stripOuterFence(raw: string): string | null {
  const match = raw.match(
    /^```(?:json|json5|jsonc)?\s*\n?([\s\S]+?)\n?```\s*$/i,
  );
  return match ? match[1]!.trim() : null;
}

function findBalancedObject(source: string): string | null {
  const start = source.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escaped = true;
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
      stringQuote = char;
      continue;
    }

    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

// best-effort transforms to normalise LLM output into strict JSON.
// keeps string contents untouched while fixing unquoted keys,
// single-quoted strings, and trailing commas.
export function normaliseJsonLike(raw: string): string {
  let output = "";
  let index = 0;

  while (index < raw.length) {
    const char = raw[index]!;

    if (char === '"') {
      const end = findStringEnd(raw, index, '"');
      output += raw.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (char === "'") {
      const end = findStringEnd(raw, index, "'");
      output += '"';
      output += escapeSingleQuotedBody(raw.slice(index + 1, end));
      output += '"';
      index = end + 1;
      continue;
    }

    output += char;
    index += 1;
  }

  output = output.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');
  output = output.replace(/,(\s*[}\]])/g, "$1");

  return output;
}

function findStringEnd(
  source: string,
  start: number,
  quote: '"' | "'",
): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index;
    index += 1;
  }
  return source.length - 1;
}

function escapeSingleQuotedBody(body: string): string {
  return body.replace(/\\'/g, "'").replace(/"/g, '\\"');
}

// tries strict JSON.parse first, then progressively tolerant transforms.
// returns { ok: true, value } on success, { ok: false } otherwise.
export function tolerantJsonParse(raw: string): Parsed {
  const payload = stripJsonPayload(raw);
  if (!payload) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(payload) };
  } catch {
    // fall through
  }

  try {
    return { ok: true, value: JSON.parse(normaliseJsonLike(payload)) };
  } catch {
    return { ok: false };
  }
}
