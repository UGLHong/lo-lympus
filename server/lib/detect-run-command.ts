import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DetectedRunCommand {
  command: string;
  source: string;
}

export interface DetectRunCommandResult {
  primary: DetectedRunCommand | null;
  candidates: DetectedRunCommand[];
}

// each detector returns a single candidate or null. detectors are executed in
// priority order: explicit overrides / README hints first, then declarative
// orchestration (compose, make), then project manifests (package.json, python,
// go, rust).
type Detector = (workspaceDir: string) => DetectedRunCommand | null;

export function detectRunCommand(workspaceDir: string): DetectRunCommandResult {
  const detectors: Detector[] = [
    detectExplicitOverride,
    detectReadmeHint,
    detectDockerCompose,
    detectMakefileTarget,
    detectNodeScript,
    detectPython,
    detectGoBinary,
    detectRustBinary,
    detectRubyOnRails,
  ];

  const candidates: DetectedRunCommand[] = [];
  for (const detect of detectors) {
    try {
      const hit = detect(workspaceDir);
      if (hit) candidates.push(hit);
    } catch {
      // ignore detector failures — they shouldn't block startup.
    }
  }

  return { primary: candidates[0] ?? null, candidates };
}

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function firstExisting(workspaceDir: string, names: readonly string[]): string | null {
  for (const name of names) {
    const full = resolve(workspaceDir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function detectExplicitOverride(workspaceDir: string): DetectedRunCommand | null {
  const overrideFile = firstExisting(workspaceDir, [
    '.olympus-run',
    '.software-house/run-command',
  ]);
  if (!overrideFile) return null;
  const raw = readIfExists(overrideFile);
  if (!raw) return null;
  const line = raw
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith('#'));
  if (!line) return null;
  return { command: line, source: `override file: ${overrideFile.replace(workspaceDir + '/', '')}` };
}

// scan README.md / DEPLOYMENT.md for a "how to run" section and extract the
// first shell code fence below it. this mirrors what the agents are told to
// author so humans get the same command the tests / deployment use.
function detectReadmeHint(workspaceDir: string): DetectedRunCommand | null {
  const candidates = [
    'README.md',
    'readme.md',
    '.software-house/DEPLOYMENT.md',
    '.software-house/PLAN.md',
  ];
  for (const relativePath of candidates) {
    const full = resolve(workspaceDir, relativePath);
    const content = readIfExists(full);
    if (!content) continue;
    const command = extractRunCommandFromMarkdown(content);
    if (command) return { command, source: `${relativePath} "how to run" section` };
  }
  return null;
}

function extractRunCommandFromMarkdown(markdown: string): string | null {
  const sectionRegex = /^#{1,6}\s+.*?(run|start|develop|boot).*?$/im;
  const match = markdown.match(sectionRegex);
  if (!match) return null;
  const sectionStart = match.index ?? 0;
  const remainder = markdown.slice(sectionStart);
  const fenceRegex = /```(?:bash|sh|shell|zsh|console)?\s*\n([\s\S]*?)```/;
  const fenceMatch = remainder.match(fenceRegex);
  if (!fenceMatch) return null;
  const lines = fenceMatch[1]
    .split('\n')
    .map((line) => line.replace(/^\$\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const runCandidate = lines.find((line) => /(dev|start|serve|run|up)/i.test(line));
  return runCandidate ?? lines[0] ?? null;
}

function detectDockerCompose(workspaceDir: string): DetectedRunCommand | null {
  const composeFile = firstExisting(workspaceDir, [
    'compose.yml',
    'compose.yaml',
    'docker-compose.yml',
    'docker-compose.yaml',
  ]);
  if (!composeFile) return null;
  return {
    command: 'docker compose up --build',
    source: `detected ${composeFile.replace(workspaceDir + '/', '')}`,
  };
}

function detectMakefileTarget(workspaceDir: string): DetectedRunCommand | null {
  const makefile = firstExisting(workspaceDir, ['Makefile', 'makefile', 'GNUmakefile']);
  if (!makefile) return null;
  const content = readIfExists(makefile);
  if (!content) return null;
  const targetPriority = ['dev', 'run', 'start', 'serve', 'up'];
  const targetRegex = /^([A-Za-z0-9_.-]+)\s*:/gm;
  const available = new Set<string>();
  for (const match of content.matchAll(targetRegex)) {
    available.add(match[1]);
  }
  for (const target of targetPriority) {
    if (available.has(target)) {
      return { command: `make ${target}`, source: `Makefile target "${target}"` };
    }
  }
  return null;
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
  packageManager?: string;
}

function detectNodeScript(workspaceDir: string): DetectedRunCommand | null {
  const packageJsonPath = resolve(workspaceDir, 'package.json');
  const raw = readIfExists(packageJsonPath);
  if (!raw) return null;
  let parsed: PackageJsonShape;
  try {
    parsed = JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
  const scripts = parsed.scripts ?? {};
  const scriptPriority = ['dev', 'start', 'serve', 'develop'];
  const scriptName = scriptPriority.find((name) => typeof scripts[name] === 'string');
  if (!scriptName) return null;

  const manager = detectPackageManager(workspaceDir, parsed.packageManager);
  const runPrefix = manager === 'npm' ? 'npm run' : manager;
  return {
    command: `${runPrefix} ${scriptName}`,
    source: `package.json "${scriptName}" script (${manager})`,
  };
}

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

function detectPackageManager(
  workspaceDir: string,
  declared: string | undefined,
): PackageManager {
  if (declared) {
    const match = declared.match(/^(pnpm|npm|yarn|bun)(?:@|$)/i);
    if (match) return match[1].toLowerCase() as PackageManager;
  }
  if (existsSync(resolve(workspaceDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(resolve(workspaceDir, 'bun.lockb'))) return 'bun';
  if (existsSync(resolve(workspaceDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(workspaceDir, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

function detectPython(workspaceDir: string): DetectedRunCommand | null {
  if (existsSync(resolve(workspaceDir, 'manage.py'))) {
    return {
      command: 'python manage.py runserver 0.0.0.0:8000',
      source: 'Django manage.py',
    };
  }

  const pyproject = readIfExists(resolve(workspaceDir, 'pyproject.toml'));
  const requirements = readIfExists(resolve(workspaceDir, 'requirements.txt'));
  const pipfile = readIfExists(resolve(workspaceDir, 'Pipfile'));
  const manifests = [pyproject, requirements, pipfile].filter(Boolean).join('\n');

  const hasFastapi = /\bfastapi\b/i.test(manifests);
  const hasUvicorn = /\buvicorn\b/i.test(manifests);
  const hasFlask = /\bflask\b/i.test(manifests);

  const entry = firstExisting(workspaceDir, [
    'main.py',
    'app.py',
    'server.py',
    'src/main.py',
    'app/main.py',
  ]);

  if ((hasFastapi || hasUvicorn) && entry) {
    const modulePath = entry.replace(workspaceDir + '/', '').replace(/\.py$/, '').replace(/\//g, '.');
    return {
      command: `uvicorn ${modulePath}:app --reload --host 0.0.0.0 --port 8000`,
      source: 'FastAPI/uvicorn app',
    };
  }

  if (hasFlask && entry) {
    const relative = entry.replace(workspaceDir + '/', '');
    return {
      command: `FLASK_APP=${relative} flask run --host=0.0.0.0 --port=5000`,
      source: 'Flask app',
    };
  }

  if (entry) {
    const relative = entry.replace(workspaceDir + '/', '');
    return { command: `python ${relative}`, source: `python entry ${relative}` };
  }

  return null;
}

function detectGoBinary(workspaceDir: string): DetectedRunCommand | null {
  if (!existsSync(resolve(workspaceDir, 'go.mod'))) return null;
  return { command: 'go run .', source: 'Go module' };
}

function detectRustBinary(workspaceDir: string): DetectedRunCommand | null {
  if (!existsSync(resolve(workspaceDir, 'Cargo.toml'))) return null;
  return { command: 'cargo run', source: 'Cargo.toml' };
}

function detectRubyOnRails(workspaceDir: string): DetectedRunCommand | null {
  if (!existsSync(resolve(workspaceDir, 'bin/rails'))) return null;
  return { command: 'bin/rails server -b 0.0.0.0', source: 'Rails app' };
}
