# Role avatars (dotLottie)

The office scene (`src/components/office/office-scene.tsx`) renders every role with `<DotLottieRoleAvatar role="<key>" state="<state>" />`. When a role has an asset bundled here the component renders it via [`@lottiefiles/dotlottie-react`](https://www.npmjs.com/package/@lottiefiles/dotlottie-react); otherwise it falls back to the colored-disc `<RoleAvatar />` placeholder so the UI never 404s.

## Contract

1. **File name** — `public/avatars/<role-key>.lottie`. The role keys are defined in `src/lib/const/roles.ts`:

   ```
   orchestrator, pm, architect, techlead, backend-dev, frontend-dev,
   devops, qa, reviewer, security, incident, release, writer
   ```

2. **Markers** — the bundle is expected to expose named markers that match the role-state enum (`src/lib/const/roles.ts`):

   | Marker name     | Fires when role state is… |
   | --------------- | ------------------------- |
   | `idle`          | `idle`, `off-duty`        |
   | `thinking`      | `thinking`                |
   | `typing`        | `typing`                  |
   | `reviewing`     | `reviewing`               |
   | `testing`       | `testing`                 |
   | `blocked`       | `blocked`                 |
   | `celebrating`   | `celebrating`             |

   The component calls `dotLottie.setMarker(<marker>)` on every state transition. Missing markers are tolerated — the animation just keeps looping its default frame range.

3. **Manifest** — after copying `<role>.lottie` here, add the role key to `public/avatars/manifest.json` under `roles[]`. The `DotLottieRoleAvatar` component reads that manifest once on mount and skips HEAD probes for every other role, so the opt-in is also the single source of truth for "which avatars exist today".

## Placeholder bundles (`pnpm build:avatars`)

A generator at `scripts/avatars/build-placeholders.ts` builds minimal per-role bundles programmatically and rewrites `manifest.json` in one go. The bundles are ~800-byte zip archives containing:

- `manifest.json` — a dotLottie v1 descriptor with a single looping animation.
- `animations/<role>.json` — a Lottie v5.7 animation whose only layer is a colored disc that pulses for 1 s. The animation carries a `markers[]` array with every state listed above, each allocated a 30-frame (1 s) segment.

Run `pnpm build:avatars` once after cloning the repo (or whenever you want to reset the placeholders). The generator is deterministic — running it again regenerates the same bytes modulo zip metadata.

When a hand-authored bundle is ready, drop it into `public/avatars/` with the role key as its file name and the generator's output will be overwritten on the next `pnpm build:avatars` run. If you want to keep your authored bundle, re-run the generator to refresh everything *except* that file by deleting it from the `for` loop in `build-placeholders.ts`, or simply stop running the script.

## Overriding the base URL

The component honours `NEXT_PUBLIC_OLYMPUS_AVATAR_BASE` (default: `/avatars`). Useful when serving assets from a CDN.

## Authoring tips

- Use [LottieFiles](https://lottiefiles.com/) or [`dotlottie-js`](https://www.npmjs.com/package/@lottiefiles/dotlottie-js) to bundle an authored JSON animation + the markers listed above into a single `.lottie` archive.
- Keep per-role bundles under ~500 KB; dotLottie is zip-compressed but large files still add to the initial paint budget.
- Match the role's accent color from `src/lib/const/roles.ts` so the avatar reads the same whether the asset is present or the placeholder fallback is.
