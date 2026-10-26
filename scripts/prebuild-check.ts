/**
 * Pre-build guard.
 *
 * `next dev` and `next build` share the same artifact directory (`.next`). Running a build
 * while a dev server is live replaces that directory underneath the running server, which
 * then fails with `Cannot find module './NNN.js'` or `ENOENT .../app-paths-manifest.json`
 * on the next request. That is a confusing failure to debug and a bad way to discover it.
 *
 * This check turns the race into an explicit, actionable error. It only probes the
 * configured dev port; CI and shared-hosting builds are unaffected.
 */

import net from "node:net";

const DEV_PORT = Number(process.env.DOMAINFITS_DEV_PORT ?? 3000);
const HOST = "127.0.0.1";
const OVERRIDE = process.env.DOMAINFITS_ALLOW_BUILD_WITH_DEV === "1";

function isPortOpen(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, HOST);
  });
}

async function main() {
  const devRunning = await isPortOpen(DEV_PORT);
  if (!devRunning) return;

  if (OVERRIDE) {
    console.warn(
      `[prebuild] A dev server is listening on :${DEV_PORT} and DOMAINFITS_ALLOW_BUILD_WITH_DEV=1 is set. ` +
        "The dev server will break when .next is replaced.",
    );
    return;
  }

  console.error(
    [
      "",
      `[prebuild] Refusing to build: something is listening on ${HOST}:${DEV_PORT}.`,
      "",
      "  `next build` writes to the same .next directory that `next dev` is serving from,",
      "  so building now would break the running dev server (MODULE_NOT_FOUND / ENOENT",
      "  app-paths-manifest). Stop the dev server first, then build:",
      "",
      "    npm run dev      # stop it (Ctrl-C or stop the process)",
      "    npm run build    # now safe",
      "",
      "  If the listener is something else on port 3000, override with:",
      "    DOMAINFITS_ALLOW_BUILD_WITH_DEV=1 npm run build",
      "  or point the check elsewhere with DOMAINFITS_DEV_PORT=<port>.",
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
}

main().catch((error) => {
  // Never block a build because the probe itself failed.
  console.warn("[prebuild] guard skipped:", (error as Error).message);
});
