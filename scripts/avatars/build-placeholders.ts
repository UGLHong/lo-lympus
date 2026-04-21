#!/usr/bin/env tsx
// generates per-role placeholder .lottie bundles + updates the avatars
// manifest. the lottie JSON is minimal (a single colored disc animation that
// idles and pulses) but it exposes the full marker set DotLottieRoleAvatar
// expects, so swapping in a hand-authored bundle later only requires replacing
// the .lottie archive on disk without touching any runtime code.

import fs from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { ROLE_KEYS, ROLES, type RoleKey, type RoleState } from '../../src/lib/const/roles';

const PUBLIC_AVATARS = path.resolve(__dirname, '../../public/avatars');

// state → marker timing (in frames). each marker is 30 frames @ 30fps = 1s,
// which gives dotLottie-react a concrete segment to play when setMarker()
// is called. all markers share the same underlying keyframes (one pulse
// cycle) so the disc stays visible while "idle" and pulses faster while
// "thinking" / "typing" — good enough for a placeholder.
const MARKER_PLAN: Record<RoleState, { time: number; duration: number }> = {
  'off-duty': { time: 0, duration: 30 },
  idle: { time: 0, duration: 30 },
  thinking: { time: 30, duration: 30 },
  typing: { time: 60, duration: 30 },
  reviewing: { time: 90, duration: 30 },
  testing: { time: 120, duration: 30 },
  blocked: { time: 150, duration: 30 },
  celebrating: { time: 180, duration: 30 },
};

const TOTAL_FRAMES = 210;

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function buildLottieAnimation(role: RoleKey): object {
  const def = ROLES[role];
  const [r, g, b] = hexToRgb01(def.color);

  const markers = (Object.keys(MARKER_PLAN) as RoleState[]).map((name) => ({
    cm: name,
    tm: MARKER_PLAN[name].time,
    dr: MARKER_PLAN[name].duration,
  }));

  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: TOTAL_FRAMES,
    w: 200,
    h: 200,
    nm: `${def.displayName} placeholder`,
    ddd: 0,
    assets: [],
    markers,
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: 'disc',
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [100, 100, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: {
            a: 1,
            k: [
              { t: 0, s: [90, 90, 100], h: 0, i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
              { t: 15, s: [110, 110, 100], h: 0, i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
              { t: 30, s: [90, 90, 100] },
            ],
          },
        },
        ao: 0,
        shapes: [
          {
            ty: 'gr',
            it: [
              {
                ty: 'el',
                p: { a: 0, k: [0, 0] },
                s: { a: 0, k: [140, 140] },
              },
              {
                ty: 'fl',
                c: { a: 0, k: [r, g, b, 1] },
                o: { a: 0, k: 100 },
              },
              {
                ty: 'tr',
                p: { a: 0, k: [0, 0] },
                a: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 0, k: 100 },
              },
            ],
          },
        ],
        ip: 0,
        op: TOTAL_FRAMES,
        st: 0,
        bm: 0,
      },
    ],
  };
}

function buildManifest(role: RoleKey): object {
  return {
    version: '1',
    generator: 'olympus/build-placeholders',
    author: 'olympus',
    animations: [
      {
        id: role,
        loop: true,
        autoplay: true,
        direction: 1,
        speed: 1,
      },
    ],
    themes: [],
    states: [],
  };
}

async function writeBundleForRole(role: RoleKey): Promise<string> {
  const animation = buildLottieAnimation(role);
  const manifest = buildManifest(role);

  const files = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    [`animations/${role}.json`]: strToU8(JSON.stringify(animation)),
  };

  const zipped = zipSync(files, { level: 6 });
  const outPath = path.join(PUBLIC_AVATARS, `${role}.lottie`);
  await fs.writeFile(outPath, zipped);
  return outPath;
}

async function writeManifestJson(roles: RoleKey[]): Promise<void> {
  const manifestPath = path.join(PUBLIC_AVATARS, 'manifest.json');
  const body = {
    $schema: './manifest.schema.json',
    version: 1,
    description:
      'Lists role avatar .lottie bundles that ship with the app. Add a role key once its <role>.lottie asset lives beside this file.',
    roles,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(body, null, 2)}\n`);
}

async function main(): Promise<void> {
  await fs.mkdir(PUBLIC_AVATARS, { recursive: true });

  const written: RoleKey[] = [];
  for (const role of ROLE_KEYS) {
    const outPath = await writeBundleForRole(role);
    written.push(role);
    const size = (await fs.stat(outPath)).size;
    console.log(`  wrote public/avatars/${role}.lottie (${size} bytes)`);
  }

  await writeManifestJson(written);
  console.log(`\nupdated public/avatars/manifest.json with ${written.length} role(s).`);
}

main().catch((err) => {
  console.error('avatar build failed:', err);
  process.exitCode = 1;
});
