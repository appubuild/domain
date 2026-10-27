/**
 * What must never leave the repository, checked against what actually ships.
 *
 * These are cheap, blunt string checks, and they are worth their size: a bundled service-role
 * key or a stray AI provider key is a total compromise, and it is the kind of mistake that a
 * code review misses because the string arrives through an import chain rather than a diff
 * line. The build output is the right place to look.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OUT_DIR = path.resolve("out");
const SRC_DIR = path.resolve("src");

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".map", ".md", ""]);

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/**
 * Strings that would mean a credential reached the browser. `SUPABASE_SERVICE_ROLE_KEY` and
 * friends are environment-variable *names*, which must never appear in client output either —
 * their presence means a server module got pulled into the client graph.
 *
 * Key prefixes are matched as prefixes *with a body*: supabase-js itself contains the literal
 * `"sb_secret_"` while deciding whether a string is a new-style key, and matching the bare
 * prefix would fail on the library rather than on a leak.
 */
const FORBIDDEN_STRINGS = [
  "service_role",
  "SERVICE_ROLE_KEY",
  "SUPABASE_DB_PASSWORD",
  "AI_PROVIDER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
];

const FORBIDDEN_PATTERNS: [string, RegExp][] = [
  ["new-style Supabase secret key", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["OpenAI-style key", /sk-(?:proj|ant)-[A-Za-z0-9_-]{16,}/],
];

/**
 * The anon key *is* a JWT and is supposed to be in the bundle, so a JWT cannot be flagged by
 * shape. Decode it instead: the claim that matters is `role`, and `service_role` there is a
 * full compromise.
 */
function serviceRoleJwts(contents: string): string[] {
  const hits: string[] = [];
  for (const match of contents.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split(".")[1]!, "base64url").toString("utf8")) as {
        role?: string;
      };
      if (payload.role === "service_role") hits.push("JWT with role=service_role");
    } catch {
      // not a JWT payload; nothing to decode
    }
  }
  return hits;
}

const outFiles = (await walk(OUT_DIR)).filter((file) => TEXT_EXTENSIONS.has(path.extname(file)));
const hasBuild = outFiles.length > 0;

describe.skipIf(!hasBuild)("shipped files", () => {
  it("contain no credential markers", async () => {
    const findings: string[] = [];
    for (const file of outFiles) {
      const contents = await readFile(file, "utf8");
      for (const marker of FORBIDDEN_STRINGS) {
        if (contents.includes(marker)) findings.push(`${path.relative(OUT_DIR, file)} → ${marker}`);
      }
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        if (pattern.test(contents)) findings.push(`${path.relative(OUT_DIR, file)} → ${label}`);
      }
      for (const label of serviceRoleJwts(contents)) findings.push(`${path.relative(OUT_DIR, file)} → ${label}`);
    }
    expect(findings, findings.join("\n")).toHaveLength(0);
  });

  it("load nothing from a third party", async () => {
    // No analytics vendor, no font CDN, no icon CDN. Ads are injected at runtime behind the
    // monetization gates and are the single documented exception.
    const findings: string[] = [];
    for (const file of outFiles.filter((f) => f.endsWith(".html"))) {
      const html = await readFile(file, "utf8");
      for (const match of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
        findings.push(`${path.relative(OUT_DIR, file)} → ${match[1]}`);
      }
    }
    expect(findings, findings.join("\n")).toHaveLength(0);
  });

  it("reference only same-origin scripts", async () => {
    const findings: string[] = [];
    for (const file of outFiles.filter((f) => f.endsWith(".html"))) {
      const html = await readFile(file, "utf8");
      for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        if (!match[1]!.startsWith("/")) findings.push(`${path.relative(OUT_DIR, file)} → ${match[1]}`);
      }
    }
    expect(findings, findings.join("\n")).toHaveLength(0);
  });
});

describe("source tree", () => {
  it("never reads a server-only environment variable from a client module", async () => {
    // Anything the bundler sees inside a "use client" file is inlined into public JS, so a
    // non-public variable there is either a leak or a silent `undefined`.
    const files = (await walk(SRC_DIR)).filter((file) => /\.(ts|tsx)$/.test(file));
    const findings: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (!/^\s*["']use client["'];?/m.test(source)) continue;
      for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        const name = match[1]!;
        if (!name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV") {
          findings.push(`${path.relative(SRC_DIR, file)} → process.env.${name}`);
        }
      }
    }
    expect(findings, findings.join("\n")).toHaveLength(0);
  });

  it("keeps the service-role key out of the source tree entirely", async () => {
    const files = (await walk(SRC_DIR)).filter((file) => /\.(ts|tsx)$/.test(file));
    const findings: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (source.includes("service_role") || source.includes("SERVICE_ROLE_KEY")) {
        findings.push(path.relative(SRC_DIR, file));
      }
    }
    expect(findings, findings.join("\n")).toHaveLength(0);
  });

  it("keeps environment files out of git", async () => {
    const ignore = await readFile(path.resolve(".gitignore"), "utf8");
    for (const pattern of [".env", ".env.local", ".env.*.local"]) {
      expect(ignore, `.gitignore covers ${pattern}`).toContain(pattern);
    }
  });
});
