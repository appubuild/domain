import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const node = process.execPath;
const electronEnv = { ...process.env, VITE_ELECTRON: 'true' };

function run(script, args, env = process.env) {
  const result = spawnSync(node, [resolve(root, script), ...args], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('node_modules/typescript/bin/tsc', ['-b']);
run('node_modules/vite/bin/vite.js', [
  'build', '--config', 'apps/web/vite.config.ts', '--outDir', '../../dist/electron-renderer',
], electronEnv);
await build({
  entryPoints: [resolve(root, 'apps/electron/src/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['electron'],
  target: 'node22',
  outfile: resolve(root, 'dist/electron/main.js'),
});
