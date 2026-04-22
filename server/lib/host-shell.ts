import { spawn } from 'node:child_process';
import { platform } from 'node:os';

interface LaunchResult {
  ok: boolean;
  command: string;
  error?: string;
}

// spawn a detached host-side command (editor, browser opener) and drop its
// stdio so the server process is not tied to its lifetime.
function launchDetached(command: string, args: string[]): LaunchResult {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      console.error(`[host-shell] ${command} failed:`, err);
    });
    child.unref();
    return { ok: true, command: `${command} ${args.join(' ')}`.trim() };
  } catch (error) {
    return {
      ok: false,
      command: `${command} ${args.join(' ')}`.trim(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// zed has `zed <path>` on every platform. if it's not on PATH this returns
// an error message that the caller can bubble up to the UI.
export function openInZed(workspaceDir: string): LaunchResult {
  return launchDetached('zed', [workspaceDir]);
}

// use the OS-native opener to launch the given URL in the default browser.
// on WSL we shell out to `wslview` if available, then fall back to xdg-open.
export function openInBrowser(url: string): LaunchResult {
  const os = platform();
  if (os === 'darwin') return launchDetached('open', [url]);
  if (os === 'win32') return launchDetached('cmd', ['/c', 'start', '""', url]);

  const isWsl = Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSLENV);
  if (isWsl) {
    const viaWslview = launchDetached('wslview', [url]);
    if (viaWslview.ok) return viaWslview;
  }
  return launchDetached('xdg-open', [url]);
}
