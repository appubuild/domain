/**
 * Type-checks the Supabase Edge Functions without a Deno runtime.
 *
 * Why this exists: the functions live in `supabase/functions/<name>/index.ts` and are deployed
 * by the Supabase CLI, which bundles each directory on its own. They are invisible to the
 * Next.js `tsc --noEmit` run, so a typo in a deployed function is only discovered when the
 * function starts answering 500 — after it has already replaced the working version.
 *
 * Each function is checked **in its own tsc invocation**. That is not fussiness: the function
 * files are scripts (no imports/exports), so compiling them together puts every top-level
 * constant in one global scope and produces "Cannot redeclare" errors that do not exist in
 * the real runtime. One process per file matches how they actually ship.
 *
 * `supabase/functions/_shared/deno-stub.d.ts` supplies the handful of `Deno` globals the
 * functions use. It is a type file, not runtime code.
 *
 * Usage: npm run typecheck:functions
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const FUNCTIONS_DIR = path.resolve("supabase/functions");
const STUB = path.join(FUNCTIONS_DIR, "_shared/deno-stub.d.ts");

const TSC_FLAGS = [
  "--noEmit",
  "--strict",
  "--target",
  "es2022",
  "--module",
  "esnext",
  "--moduleResolution",
  "bundler",
  "--lib",
  "es2022,dom",
  "--skipLibCheck",
  // Deno imports carry explicit `.ts` extensions; tsc needs to be told that is intentional.
  "--allowImportingTsExtensions",
];

type Outcome = { name: string; ok: boolean; output: string };

function main(): number {
  if (!existsSync(FUNCTIONS_DIR)) {
    console.log("[functions] no supabase/functions directory — nothing to check");
    return 0;
  }
  if (!existsSync(STUB)) {
    console.error(`[functions] missing ${path.relative(process.cwd(), STUB)}`);
    return 1;
  }

  const names = readdirSync(FUNCTIONS_DIR)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => statSync(path.join(FUNCTIONS_DIR, name)).isDirectory())
    .filter((name) => existsSync(path.join(FUNCTIONS_DIR, name, "index.ts")))
    .sort();

  if (names.length === 0) {
    console.log("[functions] no Edge Functions found");
    return 0;
  }

  const outcomes: Outcome[] = names.map((name) => {
    const entry = path.join(FUNCTIONS_DIR, name, "index.ts");
    const result = spawnSync("npx", ["tsc", ...TSC_FLAGS, entry, STUB], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return { name, ok: result.status === 0, output };
  });

  for (const outcome of outcomes) {
    if (outcome.ok) {
      console.log(`  ok   ${outcome.name}`);
      continue;
    }
    console.error(`  FAIL ${outcome.name}`);
    if (outcome.output) console.error(outcome.output.replace(/^/gm, "       "));
  }

  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  console.log(
    `\n[functions] ${outcomes.length - failed}/${outcomes.length} type-check clean${
      failed ? `, ${failed} failed` : ""
    }`,
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
