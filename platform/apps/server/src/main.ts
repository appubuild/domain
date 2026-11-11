import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { createApp } from './app.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = await createContext(config);
  ctx.ensureDefaultSettings();

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../app/dist'), resolve(here, '../public'), join(process.cwd(), 'apps/app/dist')];
  const staticDir = candidates.find((c) => existsSync(join(c, 'index.html')));

  const app = createApp(ctx, staticDir ? { staticDir } : {});
  const { port } = await app.listen();
  const capabilityLine = ctx.capabilities.forCharacter(null);
  // eslint-disable-next-line no-console
  console.log(
    [
      `AURA server listening on http://${config.host}:${port}`,
      `  data dir:   ${config.dataDir}`,
      `  database:   ${config.dbPath} (schema v${ctx.schemaVersion})`,
      `  workspace:  ${config.workspaceRoot}`,
      `  dev license:${config.devMode ? ' ON (development mode)' : ' off'}`,
      `  browser:    ${capabilityLine.browser ? 'available' : 'not available in server mode'} | computer: ${capabilityLine.computer ? 'available' : 'not available in server mode'}`,
      staticDir ? `  serving UI from ${staticDir}` : '  UI not built yet (run npm run build -w @aura/app)',
    ].join('\n'),
  );

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down…`);
    await app.close();
    ctx.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('AURA failed to start:', err);
  process.exit(1);
});
