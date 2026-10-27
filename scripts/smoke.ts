/**
 * Post-deploy smoke test.
 *
 * A deployment can be "READY" and still be wrong: the wrong environment, a missing redirect,
 * an edge function the build never wired up, a 404 handler that returns 200. This hits a real
 * server and checks the things that only exist once it is serving.
 *
 *   npm run smoke                          # against NEXT_PUBLIC_APP_URL (or the argument)
 *   npm run smoke -- https://example.com
 *   npm run smoke -- --dir out             # self-contained run against the built files
 *   npm run smoke -- --check-functions     # also call the availability service
 *
 * `--dir` exists because the build output is the artefact under test: it starts a tiny static
 * server over `out/` and runs the same checks. That is the only mode that can be run on a
 * machine without network access, and it is what CI should use before uploading anywhere.
 *
 * Exit code 1 means at least one check failed. Warnings (headers a host does not send, a
 * trailing-slash redirect the host implements differently) do not fail the run — they are
 * reported so "passing" never implies "verified everything".
 */

import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type Result = { name: string; ok: boolean; detail: string; fatal: boolean };

const results: Result[] = [];

function record(name: string, ok: boolean, detail: string, fatal = true): void {
  results.push({ name, ok, detail, fatal });
}

const ROUTES = ["/", "/generator/", "/about/", "/faq/", "/blog/", "/admin/login/"];
const STATIC_FILES = ["/sitemap.xml", "/robots.txt", "/redirects.json", "/404.html"];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Minimal static server that mimics the hosting contract: trailing slashes, 404.html, types. */
async function serveDirectory(dir: string): Promise<{ base: string; server: Server }> {
  const root = path.resolve(dir);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);

    const send = async (file: string, status = 200): Promise<void> => {
      try {
        const body = await readFile(file);
        response.writeHead(status, {
          "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
          "cache-control": pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
        });
        response.end(body);
      } catch {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
      }
    };

    if (!pathname.endsWith("/") && !path.extname(pathname)) {
      const asDirectory = path.join(root, pathname, "index.html");
      if (await stat(asDirectory).then(() => true, () => false)) {
        response.writeHead(301, { location: `${pathname}/` });
        response.end();
        return;
      }
    }

    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(root, pathname.replace(/^\//, ""));
    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const exists = await stat(file).then(() => true, () => false);
    if (exists) return send(file);
    return send(path.join(root, "404.html"), 404);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server };
}

async function get(base: string, route: string): Promise<{ status: number; headers: Headers; body: string }> {
  const response = await fetch(`${base}${route}`, { redirect: "manual" });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--dir");
  const dir = dirIndex > -1 ? args[dirIndex + 1] : null;
  const checkFunctions = args.includes("--check-functions");
  const requireHeaders = args.includes("--require-headers");
  const explicit = args.find((arg) => arg.startsWith("http"));

  let server: Server | null = null;
  let base = explicit ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (dir) {
    const started = await serveDirectory(dir);
    server = started.server;
    base = started.base;
    console.log(`[smoke] serving ${dir} at ${base}\n`);
  } else if (!base) {
    console.error("[smoke] give a base URL, set NEXT_PUBLIC_APP_URL, or use --dir out");
    process.exitCode = 1;
    return;
  }

  try {
    for (const route of ROUTES) {
      const { status, body } = await get(base, route);
      record(`GET ${route}`, status === 200, `HTTP ${status}`);
      if (status === 200) {
        record(`${route} has a title`, /<title>[^<]{3,}<\/title>/.test(body), "<title> present");
        record(`${route} has exactly one h1`, (body.match(/<h1[\s>]/g) ?? []).length === 1, `${(body.match(/<h1[\s>]/g) ?? []).length} h1`);
        const thirdParty = [...body.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]!);
        record(`${route} loads nothing third-party`, thirdParty.length === 0, thirdParty.slice(0, 3).join(", ") || "none");
      }
    }

    for (const file of STATIC_FILES) {
      const { status } = await get(base, file);
      record(`GET ${file}`, status === 200, `HTTP ${status}`);
    }

    const missing = await get(base, "/this-route-does-not-exist/");
    record("unknown route returns 404", missing.status === 404, `HTTP ${missing.status}`, false);

    const manifest = await get(base, "/redirects.json");
    if (manifest.status === 200) {
      try {
        const parsed = JSON.parse(manifest.body) as {
          source?: string;
          redirects?: unknown[];
          build?: { integrations?: Record<string, string | null>; adsEnabled?: boolean; commit?: string | null };
        };
        record("redirects.json parses", true, `${parsed.redirects?.length ?? 0} redirect(s), source ${parsed.source}`);
        const integrations = parsed.build?.integrations ?? {};
        const wired = Object.entries(integrations).filter(([, value]) => Boolean(value));
        console.log(
          `[smoke] build manifest: commit ${parsed.build?.commit ?? "unknown"} · ads ${parsed.build?.adsEnabled ? "on" : "off"} · ` +
            (wired.length ? `functions ${wired.map(([name]) => name).join(", ")}` : "no edge functions wired"),
        );
        for (const [name, url] of wired) {
          record(`build wires ${name}`, /^https:\/\//.test(url!), url!, false);
        }
        if (checkFunctions && integrations.availabilityFunction) {
          const probe = await fetch(`${integrations.availabilityFunction}?domain=example.com`);
          const payload = (await probe.json().catch(() => null)) as { results?: { status?: string }[] } | null;
          const status = payload?.results?.[0]?.status ?? "missing";
          record("availability service answers", probe.status === 200 && status !== "missing", `HTTP ${probe.status} → ${status}`);
        }
      } catch (error) {
        record("redirects.json parses", false, (error as Error).message);
      }
    }

    const home = await get(base, "/");
    const headers: [string, boolean][] = [
      ["content-security-policy", Boolean(home.headers.get("content-security-policy"))],
      ["x-content-type-options", home.headers.get("x-content-type-options") === "nosniff"],
      ["referrer-policy", Boolean(home.headers.get("referrer-policy"))],
      ["strict-transport-security", Boolean(home.headers.get("strict-transport-security"))],
    ];
    const absent = headers.filter(([, present]) => !present).map(([name]) => name);
    record(
      "security headers present",
      absent.length === 0,
      absent.length ? `missing: ${absent.join(", ")} (expected on Apache/Netlify — Vercel ignores .htaccess)` : "all present",
      requireHeaders,
    );

    const slash = await fetch(`${base}/about`, { redirect: "manual" });
    record("trailing-slash redirect", [200, 301, 308].includes(slash.status), `HTTP ${slash.status}`, false);
  } finally {
    if (server) server.close();
  }

  const failed = results.filter((result) => !result.ok && result.fatal);
  const warned = results.filter((result) => !result.ok && !result.fatal);

  console.log("");
  for (const result of results) {
    const mark = result.ok ? "ok  " : result.fatal ? "FAIL" : "warn";
    console.log(`${mark} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  console.log(`\n[smoke] ${results.length - failed.length - warned.length} passed · ${warned.length} warning(s) · ${failed.length} failure(s)`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[smoke] failed:", error);
  process.exitCode = 1;
});
