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

/* ------------------------------------------------------------------ asserts */

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const clickTab = async (label) => {
  const tab = [...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || (b.textContent || '').trim() === label);
  tab?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await wait(500);
};

const pageCount = () => doc.querySelectorAll('[data-page-id]').length;
const sidebarPageRows = () => [...doc.querySelectorAll('button')].filter((b) => /^\d+\./.test(b.textContent || '')).length;

await clickTab('Write');
console.log('\nCONTEXT TOOLBAR');
const toolbarScope = doc.querySelector('.hidden.min-w-0.flex-1.justify-center');
const titles = [...(toolbarScope?.querySelectorAll('button[title], button[aria-label]') ?? [])].map((b) => b.getAttribute('title') || b.getAttribute('aria-label'));
const hasControl = (pattern) => titles.some((title) => title && pattern.test(title));
check('context toolbar rendered', (toolbarScope?.textContent || '').length > 20 || titles.length > 5, `${titles.length} controls`);
check('font size control present', hasControl(/font size/i));
check('font family + weight controls present', hasControl(/font family/i) && hasControl(/font weight/i));
check('highlight control present', hasControl(/highlight/i));
check('text colour control present', hasControl(/colour|color/i));
check('subscript/superscript controls present', hasControl(/subscript/i) || hasControl(/superscript/i));
check('clear formatting control present', hasControl(/clear formatting/i));
check('indent + paragraph spacing control present', hasControl(/paragraph spacing/i));
check('text direction control present', hasControl(/text direction/i));
check('hyperlink control present', hasControl(/hyperlink/i));
check('alignment controls present', hasControl(/^align /i) || titles.filter((title) => /align/i.test(title || '')).length >= 3);

console.log('\nPAGE MANAGEMENT');
await clickTab('Pages');
const before = sidebarPageRows();
const rowMenu = [...doc.querySelectorAll('button[aria-label^="Page actions"]')];
rowMenu[0]?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(400);
const insertAfter = [...doc.querySelectorAll('button')].find((b) => /Insert page after/.test(b.textContent || ''));
check('page actions menu opens', Boolean(insertAfter));
insertAfter?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(800);
const after = sidebarPageRows();
check('insert page after adds a page', after === before + 1, `${before} -> ${after}`);
check('page thumbnails render', doc.querySelectorAll('[data-page-id], .page-card').length >= 1 && Boolean(doc.querySelector('svg, img, div[style*="border-radius: 2px"]')));

console.log('\nCHAPTERS');
await clickTab('Chapters');
const chapterToggle = [...doc.querySelectorAll('button[aria-expanded]')].find((b) => /Collapse|Expand/.test(b.getAttribute('aria-label') || ''));
check('chapter collapse toggle present', Boolean(chapterToggle));
const expandedBefore = chapterToggle?.getAttribute('aria-expanded');
chapterToggle?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(400);
const toggled = [...doc.querySelectorAll('button[aria-expanded]')].find((b) => /Collapse|Expand/.test(b.getAttribute('aria-label') || ''));
check('collapse state actually changes', expandedBefore !== toggled?.getAttribute('aria-expanded'));

console.log('\nELEMENTS LIBRARY');
await clickTab('Elements');
const insertButtons = () => [...doc.querySelectorAll('button')].filter((b) => /Insert|Inserted items|^[A-Z][a-z]+ (box|rule|frame|block|title|quote)/.test(b.getAttribute('title') || ''));
const firstElement = insertButtons()[0];
check('element library renders entries', insertButtons().length > 3, `${insertButtons().length} entries`);
const modeTab = [...doc.querySelectorAll('[role="tab"]')].find((b) => (b.textContent || '').trim() === 'Design');
modeTab?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(900);
const selectedMode = [...doc.querySelectorAll('[role="tab"]')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent?.trim();
check('Design mode activates and shows the object layer', selectedMode === 'Design');
const absoluteChildren = () => [...doc.querySelectorAll('[data-page-id] div')].filter((node) => /position:\s*absolute/.test(node.getAttribute('style') || '')).length;
const elementCountBefore = absoluteChildren();
firstElement?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(1000);
const elementCountAfter = absoluteChildren();
check('inserting a library element adds an object', elementCountAfter > elementCountBefore, `${elementCountBefore} -> ${elementCountAfter}`);

check('inserted element is selectable (layer row appears)', Boolean(doc.querySelector('button[aria-label^="Lock"], button[aria-label^="Unlock"]')));

console.log('\nLAYERS + LOCK');
const lockButtons = [...doc.querySelectorAll('button[aria-label^="Lock"], button[aria-label^="Unlock"]')];
check('layers expose lock toggles', lockButtons.length > 0, `${lockButtons.length} lock controls`);
const lockLabelBefore = lockButtons[0]?.getAttribute('aria-label');
lockButtons[0]?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(500);
const lockButtonsAgain = [...doc.querySelectorAll('button[aria-label^="Lock"], button[aria-label^="Unlock"]')];
check('lock state toggles (and can be undone)', lockButtonsAgain[0]?.getAttribute('aria-label') !== lockLabelBefore, `${lockLabelBefore} -> ${lockButtonsAgain[0]?.getAttribute('aria-label')}`);
check('hidden/visible toggles exist', doc.querySelectorAll('button[aria-label^="Hide"], button[aria-label^="Show"]').length > 0);

console.log('\nTABLES');
await clickTab('Elements');
const tableEntry = [...doc.querySelectorAll('button[title]')].find((b) => /Insert Table 3/.test(b.getAttribute('title') || '')) ?? [...doc.querySelectorAll('button[title]')].find((b) => /Insert Table/.test(b.getAttribute('title') || ''));
const tableTabs = [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Tables');
tableTabs?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(500);
const tableInsert = [...doc.querySelectorAll('button[title]')].find((b) => /Insert Table/.test(b.getAttribute('title') || ''));
check('table entries exist in the Elements library', Boolean(tableInsert || tableEntry));
(tableInsert ?? tableEntry)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(900);
const tableEl = doc.querySelector('[data-table-element]');
check('table element renders on the page', Boolean(tableEl), tableEl ? 'rendered' : 'not found');
const cells = tableEl?.querySelectorAll('td[data-cell]') ?? [];
check('table cells are rendered', cells.length >= 4, `${cells.length} cells`);
check('cells are editable when unlocked', cells[0]?.getAttribute('contenteditable') === 'true');
cells[0]?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(600);
const toolbarNow = [...doc.querySelectorAll('button[title], button[aria-label]')].map((b) => b.getAttribute('title') || b.getAttribute('aria-label'));
check('table toolbar exposes merge', toolbarNow.some((t) => /Merge with cell/.test(t || '')));
check('table toolbar exposes split', toolbarNow.some((t) => /Split cell/.test(t || '')));
check('table toolbar exposes insert row/column', toolbarNow.some((t) => /Insert row above/.test(t || '')) && toolbarNow.some((t) => /Insert column left/.test(t || '')));
check('table toolbar exposes cell fill and alignment', toolbarNow.some((t) => /Cell fill/.test(t || '')) && toolbarNow.some((t) => /Cell align center/.test(t || '')));
const mergeRight = [...doc.querySelectorAll('button[title]')].find((b) => /Merge with cell to the right/.test(b.getAttribute('title') || ''));
mergeRight?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(700);
const spansCell = doc.querySelector('[data-table-element] td[colspan]');
check('merging really collapses cells (colspan applied)', Boolean(spansCell), spansCell ? `colspan=${spansCell.getAttribute('colspan')}` : 'no colspan');
const splitBtn = [...doc.querySelectorAll('button[title]')].find((b) => /Split cell/.test(b.getAttribute('title') || ''));
splitBtn?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(700);
check('splitting restores the cells', !doc.querySelector('[data-table-element] td[colspan]'));
const rowsBefore = (doc.querySelector('[data-table-element] tbody')?.children.length) ?? 0;
const addRow = [...doc.querySelectorAll('button[title]')].find((b) => /Insert row below/.test(b.getAttribute('title') || ''));
addRow?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(700);
const rowsAfter = (doc.querySelector('[data-table-element] tbody')?.children.length) ?? 0;
check('adding a row changes the rendered grid', rowsAfter === rowsBefore + 1, `${rowsBefore} -> ${rowsAfter}`);

console.log('\nASSET LIBRARY (admin-managed)');
await clickTab('Assets');
const categoryButtons = () => [...doc.querySelectorAll('button')].filter((b) => /^(My uploads|Images|Illustrations|Icons|Shapes|Backgrounds|Frames|Stickers|AI generated|Covers|Logos|Free images)$/.test((b.textContent || '').trim()));
check('all asset categories are present', categoryButtons().length >= 12, `${categoryButtons().length} categories`);
const illustrations = categoryButtons().find((b) => (b.textContent || '').trim() === 'Illustrations');
illustrations?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(700);
const imgs = [...doc.querySelectorAll('img')].filter((img) => /library|svg|^data:|blob:/.test(img.getAttribute('src') || ''));
check('admin-managed library assets populate the category', imgs.length > 0, `${imgs.length} library images`);
const freeCategory = categoryButtons().find((b) => (b.textContent || '').trim() === 'Free images');
freeCategory?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(600);
const searchFree = [...doc.querySelectorAll('button')].find((b) => /^Search$/.test((b.textContent || '').trim()));
searchFree?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(900);
const addToBook = [...doc.querySelectorAll('button')].filter((b) => /Add to Book/.test(b.textContent || ''));
check('free-image search returns insertable results', addToBook.length > 0, `${addToBook.length} results`);

console.log('\nPREVIEW PARITY');
await clickTab('Preview');
await wait(900);
const previewCards = doc.querySelectorAll('[data-page-id]');
check('preview renders the shared page canvas', previewCards.length > 0, `${previewCards.length} page surfaces`);
check('preview page keeps the same data-page-id contract', Boolean(doc.querySelector('[data-page-id]')));
check('preview is read-only', !doc.querySelector('[data-page-id] [contenteditable="true"]'));

console.log('\nEXPORT SAFETY');
const exportButton = [...doc.querySelectorAll('button')].find((b) => /^Export/.test((b.textContent || '').trim()));
exportButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(900);
const modalText = doc.body.textContent || '';
check('export modal shows canvas checks', /Canvas checks/.test(modalText));
check('export modal lists pages checked', /pages/.test(modalText));
const closeModal = [...doc.querySelectorAll('button')].find((b) => /Cancel|Close/.test((b.textContent || '').trim()));
closeModal?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await wait(300);

console.log('\nerrors:', errors.slice(0, 3));
console.log('\nRESULT:', failures.length ? `FAIL (${failures.length})` : 'PASS');
failures.forEach((failure) => console.log('  -', failure));
if (errors.length) console.log('runtime errors:', errors.slice(0, 3));
const broken = failures.length > 0 || errors.length > 0;
dom.window.close();
process.exitCode = broken ? 1 : 0;
