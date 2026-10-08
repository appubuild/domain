/**
 * Reports the built chunk sizes (raw + gzip) so performance work is measurable.
 * Usage: npm run report:size
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const dir = path.join(process.cwd(), 'dist', 'assets');
const rows = readdirSync(dir)
  .filter((file) => file.endsWith('.js') || file.endsWith('.css'))
  .map((file) => {
    const full = path.join(dir, file);
    const raw = statSync(full).size;
    const gzip = gzipSync(readFileSync(full)).length;
    return { file, raw, gzip };
  })
  .sort((a, b) => b.raw - a.raw);

const total = rows.reduce((sum, row) => sum + row.raw, 0);
const totalGzip = rows.reduce((sum, row) => sum + row.gzip, 0);

console.log('chunk'.padEnd(46) + 'raw'.padStart(10) + 'gzip'.padStart(10));
console.log('-'.repeat(66));
for (const row of rows.slice(0, 18)) {
  console.log(row.file.padEnd(46) + `${(row.raw / 1024).toFixed(1)} kB`.padStart(10) + `${(row.gzip / 1024).toFixed(1)} kB`.padStart(10));
}
console.log('-'.repeat(66));
console.log(`${rows.length} files`.padEnd(46) + `${(total / 1024).toFixed(1)} kB`.padStart(10) + `${(totalGzip / 1024).toFixed(1)} kB`.padStart(10));

const entry = rows.find((row) => /^index-.*\.js$/.test(row.file));
if (entry) {
  console.log(`\nentry chunk: ${(entry.raw / 1024).toFixed(1)} kB raw / ${(entry.gzip / 1024).toFixed(1)} kB gzip`);
  const eager = rows.filter((row) => /^(index-.*\.js|index-.*\.css|vendor.*\.js)$/.test(row.file));
  console.log(`initial download (entry + vendor chunks + css): ${(eager.reduce((sum, row) => sum + row.gzip, 0) / 1024).toFixed(1)} kB gzip`);
  console.log('  includes: ' + eager.map((row) => `${row.file.split('-')[0]} ${(row.gzip / 1024).toFixed(1)}kB`).join(', '));
  const lazy = rows.filter((row) => !eager.includes(row) && row.file.endsWith('.js'));
  console.log(`lazy chunks (downloaded on demand): ${lazy.length} files, largest ${Math.max(...lazy.map((row) => row.raw / 1024)).toFixed(0)} kB raw`);
}
