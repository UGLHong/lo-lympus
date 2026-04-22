import { createRequire } from 'node:module';

import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// phaser's UMD build (dist/phaser.js) breaks under vite's ESM transform because
// its wrapper assigns to `this.Phaser` — `this` is undefined in strict ESM.
// Resolve `phaser` to its ESM entry via an absolute path so the alias rule
// doesn't recurse on itself.
const require_ = createRequire(import.meta.url);
const phaserEsmPath = require_.resolve('phaser/dist/phaser.esm.js');

export default defineConfig({
  server: {
    port: Number(process.env.OLYMPUS_WEB_PORT ?? 3100),
    host: process.env.OLYMPUS_HOST ?? '0.0.0.0',
  },
  plugins: [reactRouter(), tsconfigPaths()],
  resolve: {
    alias: [{ find: /^phaser$/, replacement: phaserEsmPath }],
  },
  ssr: {
    noExternal: ['@mastra/core', '@mastra/memory', '@mastra/pg'],
  },
});
