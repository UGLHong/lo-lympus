'use client';

import { useCallback, useEffect, useState } from 'react';
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
  bgColor?: string;
};

// setMarker is intentionally omitted: the current .lottie bundles contain
// markers with inverted frame bounds that cause a thorvg WASM panic inside
// requestAnimationFrame (uncatchable by JS try-catch or error boundaries).
// re-enable once the bundles are rebuilt with valid marker segments.

const ROLE_BUNDLE_BASE = process.env.NEXT_PUBLIC_OLYMPUS_AVATAR_BASE ?? '/avatars';

// renders a per-role dotLottie (thorvg) avatar from `<public>/avatars/<role>.lottie`.
// availability is driven by `public/avatars/manifest.json`; when the manifest
// omits the role or the WASM player emits a render/load error we fall back to
// the colored-disc placeholder so crashes are never visible to the user.
export function DotLottieRoleAvatar({ role, state = 'idle', size = 52, className, bgColor }: Props) {
  const manifest = useAvatarManifest(ROLE_BUNDLE_BASE);
  const [dotLottie, setDotLottie] = useState<DotLottie | null>(null);
  const [hasError, setHasError] = useState(false);
  const bundleUrl = `${ROLE_BUNDLE_BASE}/${role}.lottie`;
  const def = ROLES[role];
  const hasAsset = manifest?.roles.includes(role) ?? null;
  const backgroundColor = bgColor ?? `linear-gradient(135deg, ${def.color}22, ${def.color}11)`;

  const handleReady = useCallback((instance: DotLottie | null) => {
    setDotLottie(instance);
  }, []);

  useEffect(() => {
    if (!dotLottie || hasAsset !== true) return;

    const handleLoadError = () => setHasError(true);
    const handleRenderError = () => setHasError(true);

    const startPlay = () => dotLottie.play();

    dotLottie.addEventListener('loadError', handleLoadError);
    dotLottie.addEventListener('renderError', handleRenderError);

    if (dotLottie.isLoaded) {
      startPlay();
    } else {
      dotLottie.addEventListener('load', startPlay);
    }

    return () => {
      dotLottie.removeEventListener('load', startPlay);
      dotLottie.removeEventListener('loadError', handleLoadError);
      dotLottie.removeEventListener('renderError', handleRenderError);
    };
  }, [dotLottie, hasAsset]);

  if (hasAsset !== true || hasError) {
    return <RoleAvatar role={role} state={state} size={size} />;
  }

  return (
    <div
      className={cn('relative flex items-center justify-center rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: backgroundColor,
      }}
      title={`${def.displayName} — ${state}`}
    >
      <DotLottieReact
        src={bundleUrl}
        loop
        dotLottieRefCallback={handleReady}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
