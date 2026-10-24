import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(ROOT, 'www');
const THEME_BUNDLE = '/assets/js/capacitor-theme-sync.bundle.js';
const NATIVE_AD_CONFIG = `/* AdSense intentionally omitted from the Capacitor native bundle. */
window.DOMAINFITS_AD_CONFIG = Object.freeze({
  enabled: false,
  publisherId: '',
  slots: Object.freeze({
    'header-banner': Object.freeze({ code: '' }),
    'generator-inline': Object.freeze({ code: '' }),
    'article-inline': Object.freeze({ code: '' })
  })
});
`;
const NATIVE_AD_MANAGER = `/* Native-safe stub: never executes or loads AdSense in Capacitor apps. */
(() => {
  document.querySelectorAll('[data-ad-slot]').forEach((slot) => {
    slot.replaceChildren();
    slot.hidden = true;
  });
})();
`;

const runtimeEntries = [
  'index.html',
  'assets',
  'blog',
  'pages',
  'robots.txt',
  'sitemap.xml',
  'ads.txt',
  'manifest.webmanifest',
  'service-worker.js',
  'offline.html',
  'tools/domain-generator.html'
];

function keepRuntimeFile(sourcePath) {
  const relative = path.relative(ROOT, sourcePath).split(path.sep);
  if (relative.some((part) => ['.git', 'node_modules', 'www', 'android', 'ios'].includes(part))) return false;
  if (relative[0] === 'blog' && ['articles', 'editorial-packs'].includes(relative[1])) return false;
  if (relative[0] === 'blog' && relative[1] === 'editorial-calendar.md') return false;
  if (relative.join('/') === 'assets/js/capacitor-theme-sync.js') return false;
  if (sourcePath.toLowerCase().endsWith('.md')) return false;
  return true;
}

async function copyRuntimeTree() {
  await rm(WEB_DIR, { recursive: true, force: true });
  await mkdir(WEB_DIR, { recursive: true });
  for (const entry of runtimeEntries) {
    const source = path.join(ROOT, entry);
    const destination = path.join(WEB_DIR, entry);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      filter: (sourcePath) => keepRuntimeFile(sourcePath)
    });
  }
}

async function injectNativeThemeBundle(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await injectNativeThemeBundle(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html')) continue;

    let html = await readFile(fullPath, 'utf8');
    if (html.includes(THEME_BUNDLE)) continue;
    if (!/<\/head\s*>/i.test(html)) {
      throw new Error(`Cannot inject the native theme bridge: ${path.relative(WEB_DIR, fullPath)} has no closing </head>.`);
    }
    html = html.replace(/<\/head\s*>/i, `  <script src="${THEME_BUNDLE}" defer></script>\n</head>`);
    await writeFile(fullPath, html, 'utf8');
  }
}

const capacitorConfig = JSON.parse(await readFile(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
if (capacitorConfig.webDir !== 'www') {
  throw new Error('capacitor.config.json must use webDir "www" for the local static bundle.');
}
if (capacitorConfig.server?.url) {
  throw new Error('External server.url is disabled: Android must load the locally bundled www directory.');
}

await copyRuntimeTree();
await Promise.all([
  writeFile(path.join(WEB_DIR, 'assets/js/ads-config.js'), NATIVE_AD_CONFIG, 'utf8'),
  writeFile(path.join(WEB_DIR, 'assets/js/ad-manager.js'), NATIVE_AD_MANAGER, 'utf8')
]);
await bundle({
  entryPoints: [path.join(ROOT, 'assets/js/capacitor-theme-sync.js')],
  outfile: path.join(WEB_DIR, 'assets/js/capacitor-theme-sync.bundle.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  logLevel: 'info'
});
await injectNativeThemeBundle(WEB_DIR);
console.log('Built DomainFits local web bundle in www/; no external WebView server URL is configured.');
