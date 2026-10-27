/**
 * Writes `supabase/seed/seed.sql` from the engine's canonical data.
 *
 * The SQL itself is built by `scripts/seed-sql.ts`, which is also imported by
 * `tests/db/seed-sync.test.ts` — so the committed file is verified against its generator
 * instead of quietly drifting from it.
 *
 * Run with: npm run db:seed:generate
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSeedSql } from "./seed-sql";
import { INDUSTRIES } from "../src/lib/brain/dictionaries/industries";
import { PREFIX_LIBRARIES, SUFFIX_LIBRARIES } from "../src/lib/brain/dictionaries/words";
import { TLD_DIRECTORY } from "../src/lib/brain/tlds";
import { DEFAULT_PAGES } from "../src/lib/content/defaults";

const OUT_DIR = path.join(process.cwd(), "supabase", "seed");
const OUT_FILE = path.join(OUT_DIR, "seed.sql");

mkdirSync(OUT_DIR, { recursive: true });
const sql = buildSeedSql();
writeFileSync(OUT_FILE, sql, "utf8");

const lines = sql.split("\n").length;
console.log(`Wrote ${OUT_FILE} (${lines} lines, ${(sql.length / 1024).toFixed(1)} KB)`);
console.log(
  `  ${INDUSTRIES.length} industries, ${TLD_DIRECTORY.length} TLDs, ` +
    `${PREFIX_LIBRARIES.length + SUFFIX_LIBRARIES.length} libraries, ${DEFAULT_PAGES.length} pages`,
);
