/**
 * Generates a DELIMITER-free, re-runnable copy of the CMS migration.
 *
 *   node scripts/generate-migration-idempotent.mjs
 *
 * The hand-written migration uses stored procedures (shn_add_column /
 * shn_add_index) so it is idempotent. Procedures need the `DELIMITER` client
 * directive, which some hosts' phpMyAdmin builds do not understand — the file
 * then fails on the first line with a syntax error and none of the ALTERs run,
 * which surfaces later as "Unknown column 'seo_title' in 'INSERT INTO'".
 *
 * This generator rewrites every CALL into four plain statements:
 *
 *   SET @shn_sql = IF(<column missing>, '<ALTER …>', 'DO 0');
 *   PREPARE shn_stmt FROM @shn_sql;
 *   EXECUTE shn_stmt;
 *   DEALLOCATE PREPARE shn_stmt;
 *
 * No DELIMITER, no procedures, no error 1060 on a re-run: it can be pasted into
 * phpMyAdmin's SQL tab or run with `mysql <` as many times as you like.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const sourcePath = resolve(root, 'api/database/migrations/2026-11-blog-cms-upgrade.sql')
const outPath = resolve(root, 'api/database/migrations/2026-11-blog-cms-upgrade-idempotent.sql')

const source = readFileSync(sourcePath, 'utf8')

/** Doubles single quotes for embedding inside a SQL string literal. */
const lit = (value) => `'${value.replace(/'/g, "''")}'`

const columnCall = /^CALL shn_add_column\('([^']+)',\s*'([^']+)',\s*'((?:[^']|'')*)'\);$/gm
const indexCall = /^CALL shn_add_index\('([^']+)',\s*'([^']+)',\s*'((?:[^']|'')*)'\);$/gm

const unquote = (value) => value.replace(/''/g, "'")

/** Rewrites one CALL into a guarded, self-contained ALTER block. */
const columnBlock = (table, column, ddl) => {
  const exists =
    `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()` +
    ` AND TABLE_NAME = ${lit(table)} AND COLUMN_NAME = ${lit(column)}`
  const alter = `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${unquote(ddl)}`
  return (
    `SET @shn_sql = IF((${exists}) = 0, ${lit(alter)}, 'DO 0');\n` +
    `PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;\n`
  )
}

const indexBlock = (table, index, ddl) => {
  const exists =
    `SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()` +
    ` AND TABLE_NAME = ${lit(table)} AND INDEX_NAME = ${lit(index)}`
  const alter = `ALTER TABLE \`${table}\` ADD ${unquote(ddl)}`
  return (
    `SET @shn_sql = IF((${exists}) = 0, ${lit(alter)}, 'DO 0');\n` +
    `PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;\n`
  )
}

/** Drop the original banner + SET NAMES; this file has its own header. */
const bodySource = source.slice(source.indexOf('/* ---') !== -1 ? source.indexOf('/* ---') : 0)

let columns = 0
let indexes = 0
let body = bodySource.replace(columnCall, (_match, table, columnName, ddl) => {
  columns += 1
  return columnBlock(table, columnName, ddl)
})
body = body.replace(indexCall, (_match, table, indexName, ddl) => {
  indexes += 1
  return indexBlock(table, indexName, ddl)
})

// Strip the procedure scaffolding and the DELIMITER directives.
body = body
  .replace(/\/\* -+\n   Helper procedures:[\s\S]*?-+ \*\/\n/, '')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\nDROP PROCEDURE IF EXISTS shn_add_column;\nDROP PROCEDURE IF EXISTS shn_add_index;\n/g, '\n')
  .replace(/DROP PROCEDURE IF EXISTS shn_add_column;\n/g, '')
  .replace(/DROP PROCEDURE IF EXISTS shn_add_index;\n/g, '')
  .replace(/DELIMITER \$\$[\s\S]*?DELIMITER ;\n/, '')

const header = `-- ============================================================================
--  Safe Home Network — Blog CMS, Pages & Publishing upgrade
--  IDEMPOTENT / phpMyAdmin edition (generated — do not edit by hand)
-- ----------------------------------------------------------------------------
--  Generated from 2026-11-blog-cms-upgrade.sql by
--    node scripts/generate-migration-idempotent.mjs
--
--  Use this file when:
--    · your host's phpMyAdmin rejects the DELIMITER directive in the original
--      migration ("syntax error near DELIMITER"), or
--    · the migration was interrupted and you saw
--         #1054 Unknown column 'seo_title' in 'INSERT INTO'
--      while importing blog-content-import.sql.
--
--  It contains no procedures and no DELIMITER lines — just plain statements.
--  Every ALTER is guarded by an information_schema check, so the file is safe to
--  run as many times as you like and will not raise #1060 Duplicate column.
--
--  Run:  phpMyAdmin → select the database → SQL tab → paste this file → Go
--    or: mysql -u user -p dbname < 2026-11-blog-cms-upgrade-idempotent.sql
--
--  When it finishes you should see the verification row
--  "blog cms migration applied | 1 | 1 | 2".
-- ============================================================================

SET NAMES utf8mb4;

`

writeFileSync(outPath, header + body.replace(/^\s*\n/, ''), 'utf8')

console.log(
  `idempotent migration written: ${columns} column guards, ${indexes} index guards → ${outPath}`,
)
