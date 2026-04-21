'use client';

import { useEffect, useState } from 'react';
import type { RoleKey } from '@/lib/const/roles';

// manifest driven avatar availability. the actual `.lottie` bundles may or
// may not ship in /public/avatars; the manifest lists which role keys have
// ready-to-use assets and `DotLottieRoleAvatar` reads only from here to
// decide whether to mount the player or render the colored-disc fallback.

type Manifest = {
  version: number;
  roles: RoleKey[];
};

const FALLBACK_MANIFEST: Manifest = { version: 1, roles: [] };

let manifestPromise: Promise<Manifest> | null = null;

export function fetchAvatarManifest(baseUrl: string): Promise<Manifest> {
  if (manifestPromise) return manifestPromise;

  const pending = fetch(`${baseUrl}/manifest.json`, { cache: 'no-cache' })
    .then(async (res): Promise<Manifest> => {
      if (!res.ok) return FALLBACK_MANIFEST;
      try {
        const raw = (await res.json()) as Partial<Manifest>;
        const roles = Array.isArray(raw.roles) ? (raw.roles as RoleKey[]) : [];
        return { version: 1, roles };
      } catch {
        return FALLBACK_MANIFEST;
      }
    })
    .catch(() => FALLBACK_MANIFEST);

  manifestPromise = pending;
  return pending;
}

export function useAvatarManifest(baseUrl: string): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAvatarManifest(baseUrl).then((result) => {
      if (!cancelled) setManifest(result);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return manifest;
}
