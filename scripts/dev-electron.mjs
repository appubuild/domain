import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:4173/';
const vite = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--config', 'apps/web/vite.config.ts', '--host', '127.0.0.1', '--port', '4173', '--strictPort',
], { cwd: root, env: { ...process.env, VITE_ELECTRON: 'true' }, stdio: 'inherit' });
let electron;
let stopping = false;

function stopChildren(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  electron?.kill(signal);
  vite.kill(signal);
}
process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));
vite.on('exit', code => {
  if (!stopping && code !== 0) {
    console.error(`Vite exited with status ${code}.`);
    stopChildren();
    process.exitCode = code ?? 1;
  }
});

try {
  let ready = false;
  const deadline = Date.now() + 30_000;
  while (!ready && Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited before startup (code ${vite.exitCode}).`);
    try {
      const response = await fetch(url);
      ready = response.ok;
    } catch { await delay(200); }
  }
  if (!ready) throw new Error('Vite did not become ready within 30 seconds.');
  electron = spawn(process.execPath, [resolve(root, 'node_modules/electron/cli.js'), root], {
    cwd: root,
    env: { ...process.env, LAND_EXPERT_ELECTRON_DEV_URL: url },
    stdio: 'inherit',
  });
  electron.on('error', error => {
    console.error('Could not start Electron. Install the Electron runtime binary with npm install.', error.message);
    stopChildren();
    process.exitCode = 1;
  });
  electron.on('exit', code => {
    if (!stopping) stopChildren();
    process.exitCode = code ?? 0;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Electron development startup failed.');
  stopChildren();
  process.exitCode = 1;
}
