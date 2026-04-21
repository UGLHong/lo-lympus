import path from 'node:path';
import { nanoid } from 'nanoid';
import { sendJson } from '../jsonrpc';

type SingleEdit = {
  path: string;
  content: string;
};

// pending fs/apply_edit requests, keyed by JSON-RPC id. The session
// resolves them when Zed replies.
type PendingFsApplyEdit = {
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
};

const pending = new Map<string | number, PendingFsApplyEdit>();

export function resolveFsApplyEdit(id: string | number, ok: boolean): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.resolve(ok);
}

export function failFsApplyEdit(id: string | number, err: Error): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.reject(err);
}

// issues a `fs/apply_edit` JSON-RPC request to the ACP client (Zed).
// the promise resolves when Zed acknowledges. if the client is not
// ACP-capable (no matching response wiring), the call times out.
export function requestFsApplyEdit(edit: SingleEdit, timeoutMs = 10_000): Promise<boolean> {
  const id = `fs-apply-${nanoid(6)}`;
  const relative = normalizeRelative(edit.path);

  const request = {
    jsonrpc: '2.0' as const,
    id,
    method: 'fs/apply_edit',
    params: {
      path: relative,
      edits: [
        {
          replace: {
            content: edit.content,
          },
        },
      ],
    },
  };

  return new Promise<boolean>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sendJson(request);

    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`fs/apply_edit timed out after ${timeoutMs}ms (path=${relative})`));
    }, timeoutMs);
  });
}

function normalizeRelative(raw: string): string {
  return path.normalize(raw).replace(/^(\.\.[/\\])+/g, '').replace(/^[/\\]+/, '');
}
