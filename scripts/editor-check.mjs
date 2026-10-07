/**
 * Editor regression check (headless, jsdom).
 *
 * Guards the editor canvas against the unit-mismatch bug where `zoom` was passed as a
 * multiplier but consumed as a percentage: the page box collapsed to a few pixels and
 * the canvas looked empty and untypable.
 *
 * Usage: npm run check:editor     (needs `SMOKE_BUILD=1 node scripts/smoke.mjs /` once to build dist-smoke)
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import path from 'node:path';

const root = '/home/user/domain';
const code = readFileSync(path.join(root, 'dist-smoke/app.js'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Could not (load|parse)/i.test(e.message)) errors.push(e.message); });
vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: 'http://localhost/dashboard/books/book_keeper_ledger/editor',
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse: (window) => {
    window.localStorage.setItem('scriptora.session.v1', JSON.stringify({ userId: 'user_demo', remember: true }));
    window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    window.PointerEvent = window.MouseEvent;
    window.Element.prototype.scrollIntoView = function () {};
    window.URL.createObjectURL = () => 'blob:x';
  },
});
await new Promise((r) => setTimeout(r, 200));
const s = dom.window.document.createElement('script');
s.textContent = code;
dom.window.document.body.appendChild(s);
await new Promise((r) => setTimeout(r, 3000));

const doc = dom.window.document;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const card = doc.querySelector('[data-page-id]');
console.log('BEFORE page-switch:');
console.log('  card style:', card?.getAttribute('style'));
console.log('  PM text:', JSON.stringify(doc.querySelector('.ProseMirror')?.textContent?.slice(0, 80)));

// click the sidebar entry for the flow page ("The Boy on the Seawall" without "title page")
const entries = [...doc.querySelectorAll('button')].filter((b) => /Boy on the Seawall/.test(b.textContent || ''));
console.log('\ncandidate page entries:', entries.length);
const flowEntry = entries.reverse().find((b) => !/title page/.test(b.textContent || '')) ?? entries[0];
flowEntry?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(1200);

const card2 = doc.querySelector('[data-page-id]');
const pm = doc.querySelector('.ProseMirror');
console.log('\nAFTER clicking flow page:');
console.log('  card style:', card2?.getAttribute('style'));
console.log('  card class:', card2?.getAttribute('class'));
console.log('  PM contenteditable:', pm?.getAttribute('contenteditable'));
console.log('  PM text length:', pm?.textContent?.length ?? 0);
console.log('  PM text head:', JSON.stringify((pm?.textContent ?? '').slice(0, 140)));
console.log('  PM html head:', (pm?.innerHTML ?? '').slice(0, 140));
// --- click on the page whitespace should focus the editor (so typing works) ---
const surface = doc.querySelector('[data-page-id]');
surface?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(400);
console.log('  focused after page click:', doc.activeElement?.className?.toString().slice(0, 40) || doc.activeElement?.tagName);

// --- zoom in should scale the page, not shrink it ---
const zoomIn = [...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Zoom in');
zoomIn?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(400);
const zoomedCard = doc.querySelector('[data-page-id]');
const holder = zoomedCard?.parentElement;
console.log('  after zoom-in card style:', zoomedCard?.getAttribute('style'));
console.log('  holder size:', holder?.getAttribute('style'));

// --- switch to Design mode: elements must render over the page ---
const designTab = [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Design');
designTab?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(800);
const designCard = doc.querySelector('[data-page-id]');
console.log('\nDESIGN mode: card children =', designCard?.children.length, '| page text present =', (designCard?.textContent || '').length > 40);
console.log('  design card style:', designCard?.getAttribute('style'));

// --- switch to Write mode: the flow toolbar must be wired to the editor ---
const writeTab = [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Write');
writeTab?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(800);
const boldBtn = doc.querySelector('button[title="Bold (Ctrl+B)"]');
console.log('WRITE mode: bold button present =', Boolean(boldBtn), '| toolbar buttons =', doc.querySelectorAll('button[title]').length);
console.log('  PM still has text =', (doc.querySelector('.ProseMirror')?.textContent?.length ?? 0) > 100);

console.log('\nerrors:', errors.slice(0, 3));
dom.window.close();
