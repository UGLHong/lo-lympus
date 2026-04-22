import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { openrouterChatComplete } from './openrouter-fetch';

import type { DetectedRunCommand } from './detect-run-command';

const SIGNAL_FILES = [
  'README.md',
  'readme.md',
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'Makefile',
  'makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'manage.py',
  'app.py',
  'main.py',
  'server.py',
  'go.mod',
  'Cargo.toml',
  '.env.example',
  '.env.sample',
  'bin/rails',
  '.software-house/DEPLOYMENT.md',
  '.software-house/PLAN.md',
];

const MAX_FILE_BYTES = 4_000;
const MAX_LIST_ENTRIES = 40;
const MAX_TOTAL_CONTEXT_BYTES = 18_000;

interface WorkspaceFingerprint {
  rootListing: string[];
  signalFiles: { path: string; content: string }[];
}

// collect the smallest possible workspace snapshot that still lets the model
// tell `npm start` apart from `docker compose up` apart from `uvicorn main:app`.
function collectFingerprint(workspaceDir: string): WorkspaceFingerprint {
  const rootListing: string[] = [];
  try {
    for (const entry of readdirSync(workspaceDir)) {
      if (entry.startsWith('.git')) continue;
      const full = resolve(workspaceDir, entry);
      try {
        const isDir = statSync(full).isDirectory();
        rootListing.push(isDir ? `${entry}/` : entry);
      } catch {
        rootListing.push(entry);
      }
      if (rootListing.length >= MAX_LIST_ENTRIES) break;
    }
  } catch {
    // workspace doesn't exist or is unreadable — return empty fingerprint.
  }

  const signalFiles: { path: string; content: string }[] = [];
  let budget = MAX_TOTAL_CONTEXT_BYTES;
  for (const relativePath of SIGNAL_FILES) {
    if (budget <= 0) break;
    const full = resolve(workspaceDir, relativePath);
    if (!existsSync(full)) continue;
    try {
      const raw = readFileSync(full, 'utf8');
      const truncated = raw.length > MAX_FILE_BYTES ? `${raw.slice(0, MAX_FILE_BYTES)}\n... [truncated]` : raw;
      const cost = truncated.length + relativePath.length + 8;
      if (cost > budget) {
        signalFiles.push({ path: relativePath, content: truncated.slice(0, Math.max(0, budget)) });
        budget = 0;
      } else {
        signalFiles.push({ path: relativePath, content: truncated });
        budget -= cost;
      }
    } catch {
      // unreadable file; skip.
    }
  }

  return { rootListing, signalFiles };
}

const SYSTEM_PROMPT = [
  'You are a devops assistant that picks the correct single shell command to boot a project for LOCAL DEVELOPMENT.',
  'You receive a small snapshot of the workspace: a root directory listing and the contents of a few signal files.',
  'Rules:',
  '- Output STRICT JSON matching: {"command": string, "rationale": string, "confidence": "high"|"medium"|"low"}.',
  '- The command must run in a POSIX shell from the workspace root.',
  '- You MAY chain steps with "&&" when the project needs install before run (e.g. "pnpm install && pnpm dev", "bundle install && bin/rails server").',
  '- Prefer a dev/hot-reload command when one exists (package.json dev script, docker compose up, make dev, uvicorn --reload, etc.).',
  '- Pick the package manager from the lockfile: pnpm-lock.yaml -> pnpm, yarn.lock -> yarn, package-lock.json -> npm, bun.lockb -> bun.',
  '- If a docker-compose file exists AND the app clearly relies on it, prefer "docker compose up --build".',
  '- If the snapshot is inconclusive, return confidence "low" and the single most reasonable guess.',
  '- NEVER invent file paths or commands for stacks not evidenced in the snapshot.',
].join('\n');

function buildUserPrompt(fingerprint: WorkspaceFingerprint): string {
  const lines: string[] = [];
  lines.push('# Workspace root listing');
  lines.push(fingerprint.rootListing.length > 0 ? fingerprint.rootListing.join(', ') : '(empty)');
  lines.push('');
  lines.push('# Signal files');
  if (fingerprint.signalFiles.length === 0) {
    lines.push('(no signal files found)');
  } else {
    for (const file of fingerprint.signalFiles) {
      lines.push(`## ${file.path}`);
      lines.push('```');
      lines.push(file.content.trimEnd());
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('Return the JSON now.');
  return lines.join('\n');
}

interface AiCommandResponse {
  command?: unknown;
  rationale?: unknown;
  confidence?: unknown;
}

export async function aiDetectRunCommand(
  workspaceDir: string,
): Promise<DetectedRunCommand | null> {
  if (!process.env.OPENROUTER_API_KEY || !process.env.MODEL_TIER_FAST) return null;

  const fingerprint = collectFingerprint(workspaceDir);
  if (fingerprint.rootListing.length === 0) return null;

  let result;
  try {
    result = await openrouterChatComplete({
      tier: 'FAST',
      temperature: 0,
      maxTokens: 300,
      responseFormat: 'json_object',
      timeoutMs: 15_000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(fingerprint) },
      ],
    });
  } catch (error) {
    console.warn('[ai-run-command] llm call failed:', error);
    return null;
  }

  let parsed: AiCommandResponse;
  try {
    parsed = JSON.parse(result.content) as AiCommandResponse;
  } catch {
    console.warn('[ai-run-command] non-JSON response:', result.content.slice(0, 200));
    return null;
  }

  const command = typeof parsed.command === 'string' ? parsed.command.trim() : '';
  if (command.length === 0) return null;
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  const confidence = typeof parsed.confidence === 'string' ? parsed.confidence : 'medium';

  const source = [
    `ai (${result.modelId} · confidence: ${confidence})`,
    rationale.length > 0 ? rationale : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return { command, source };
}
