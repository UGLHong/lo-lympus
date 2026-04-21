'use client';

import { useEffect, useRef } from 'react';
import { DotLottieReact, type DotLottie } from '@lottiefiles/dotlottie-react';
import { ROLES, type RoleKey, type RoleState } from '@/lib/const/roles';
import { cn } from '@/lib/utils/cn';
import { useAvatarManifest } from '@/lib/client/avatar-manifest';
import { RoleAvatar } from './role-avatar';

type Props = {
  role: RoleKey;
  state?: RoleState;
  size?: number;
  className?: string;
};

// named segments the .lottie bundle is expected to expose via state-
// machine markers. if a marker is missing thorvg falls back to the
// animation's default frame range, so partial bundles still render.
const STATE_TO_MARKER: Record<RoleState, string> = {
  'off-duty': 'idle',
  idle: 'idle',
  thinking: 'thinking',
  typing: 'typing',
  reviewing: 'reviewing',
  testing: 'testing',
  blocked: 'blocked',
  celebrating: 'celebrating',
};

const ROLE_BUNDLE_BASE = process.env.NEXT_PUBLIC_OLYMPUS_AVATAR_BASE ?? '/avatars';

// renders a per-role dotLottie (thorvg) avatar from `<public>/avatars/<role>.lottie`.
// availability is driven by `public/avatars/manifest.json`, so adding a new
// asset is a two-step opt-in: drop the bundle in place, list the role key in
// the manifest. when the manifest says the role isn't ready we render the
// colored-disc placeholder instead of chasing a 404.
export function DotLottieRoleAvatar({ role, state = 'idle', size = 52, className }: Props) {
  const manifest = useAvatarManifest(ROLE_BUNDLE_BASE);
  const playerRef = useRef<DotLottie | null>(null);
  const bundleUrl = `${ROLE_BUNDLE_BASE}/${role}.lottie`;
  const def = ROLES[role];
  const hasAsset = manifest?.roles.includes(role) ?? null;

  useEffect(() => {
    const player = playerRef.current;
    if (!player || hasAsset !== true) return;

    const marker = STATE_TO_MARKER[state] ?? 'idle';
    try {
      player.setMarker(marker);
      player.play();
    } catch {
      // bundle has no markers — play the default loop
      player.play();
    }
  }, [state, hasAsset]);

  if (hasAsset !== true) {
    return <RoleAvatar role={role} state={state} size={size} />;
  }

  const handleReady = (instance: DotLottie | null) => {
    playerRef.current = instance;
  };

  return (
    <div
      className={cn('relative flex items-center justify-center rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${def.color}22, ${def.color}11)`,
      }}
      title={`${def.displayName} — ${state}`}
    >
      <DotLottieReact
        src={bundleUrl}
        autoplay
        loop
        dotLottieRefCallback={handleReady}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
