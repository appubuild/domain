import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [packageJson, vercel] = await Promise.all([
  readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'vercel.json'), 'utf8').then(JSON.parse),
]);
const expectedHeaders = new Map([
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Frame-Options', 'DENY'],
  ['Permissions-Policy', 'geolocation=(self), camera=(), microphone=()'],
]);

if (packageJson.engines?.node !== '>=22 <25') throw new Error('Release builds must use a supported Node 22–24 runtime.');
if (vercel.buildCommand !== 'npm run build' || vercel.outputDirectory !== 'apps/web/dist') {
  throw new Error('Vercel build command or output directory does not match the production web build.');
}
if (!vercel.rewrites?.some(rule => rule.source === '/(.*)' && rule.destination === '/index.html')) {
  throw new Error('The SPA fallback rewrite is missing.');
}
const configuredHeaders = new Map((vercel.headers ?? []).flatMap(rule => rule.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]));
for (const [key, value] of expectedHeaders) {
  if (configuredHeaders.get(key.toLowerCase()) !== value) throw new Error(`Required response header is missing or changed: ${key}.`);
}
console.log('Static release config checks passed. This does not perform deployment or verify edge response headers.');
