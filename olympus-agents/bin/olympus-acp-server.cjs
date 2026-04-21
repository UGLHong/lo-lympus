#!/usr/bin/env node
// Thin entrypoint shim: deferred require so an uninstalled build fails loudly.
try {
  require('../dist/main.js');
} catch (error) {
  process.stderr.write(
    'olympus-acp-server: build artifact missing (dist/main.js). ' +
      'Run `pnpm --filter @olympus/acp-server build` first.\n',
  );
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
