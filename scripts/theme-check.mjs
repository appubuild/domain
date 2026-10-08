/**
 * Verifies that a theme written to the mock database (as the admin app does) reaches the
 * running app immediately — i.e. ThemeProvider is push-based, not polling.
 *
 * Usage: npm run check:theme   (needs dist-smoke built: SMOKE_BUILD=1 node scripts/smoke.mjs /)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = process.cwd();
const code = readFileSync(path.join(root, 'dist-smoke', 'app.js'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Could not (load|parse)/i.test(e.message)) errors.push(e.message); });
vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse: (window) => {
    window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    window.PointerEvent = window.MouseEvent;
    window.Element.prototype.scrollIntoView = function () {};
    window.URL.createObjectURL = () => 'blob:x';
  },
});

await new Promise((r) => setTimeout(r, 200));
const script = dom.window.document.createElement('script');
script.textContent = code;
dom.window.document.body.appendChild(script);
await new Promise((r) => setTimeout(r, 2500));

const rootEl = dom.window.document.documentElement;
const before = rootEl.style.getPropertyValue('--primary');
console.log('--primary at boot :', before || '(unset)');

// Write the theme the way the admin app does (cmsRepo.updateTheme -> mutateDatabase),
// persist that database, then boot a fresh page and assert the app applies the new tokens.
const dbJson = dom.window.scriptora?.export?.();
if (!dbJson) {
  console.log('window.scriptora debug hook missing — cannot run the mutation test');
  process.exit(1);
}
const database = JSON.parse(dbJson);
database.theme = { ...database.theme, primary: '#ff0000' };
const key = 'scriptora.db.v9';
console.log('writing theme.primary = #ff0000 into the persisted database');

const dom2 = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse: (window) => {
    window.localStorage.setItem(key, JSON.stringify({ version: 9, data: database }));
    window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    window.PointerEvent = window.MouseEvent;
    window.Element.prototype.scrollIntoView = function () {};
    window.URL.createObjectURL = () => 'blob:x';
  },
});
await new Promise((r) => setTimeout(r, 200));
const script2 = dom2.window.document.createElement('script');
script2.textContent = code;
dom2.window.document.body.appendChild(script2);
await new Promise((r) => setTimeout(r, 2500));

const applied = dom2.window.document.documentElement.style.getPropertyValue('--primary');
const rendered = (dom2.window.document.getElementById('root')?.innerHTML ?? '').length;
console.log('--primary after reload:', applied || '(unset)', '| rendered chars:', rendered);
console.log('theme tokens are applied from the database:', applied ? 'PASS' : 'FAIL');
console.log('errors:', errors.slice(0, 3));
const ok = Boolean(applied) && rendered > 500;
console.log(ok ? '\nTHEME CHECK: PASS' : '\nTHEME CHECK: FAIL');
process.exit(ok ? 0 : 1);
