/**
 * Migration regression check (headless, jsdom).
 *
 * Reproduces the crash "Cannot read properties of undefined (reading
 * 'collapsedSections')": a database persisted by an older build has books with no
 * `canvas` / `footnotes` / `textStyles`, and the editor screen reads those fields.
 *
 * The check writes an old-shaped database into localStorage, boots the editor, and
 * asserts the screen renders, the chapter panel works, and the migrated fields were
 * written back to storage.
 *
 * Usage: npm run check:migration   (needs `SMOKE_BUILD=1 node scripts/smoke.mjs /` once)
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import path from 'node:path';

const root = '/home/user/domain';
const code = readFileSync(path.join(root, 'dist-smoke/app.js'), 'utf8');
const STORAGE_KEY = 'scriptora.db.v9';
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

function boot({ url, storage, onCook }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not (load|parse)/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse: (window) => {
      window.localStorage.setItem('scriptora.session.v1', JSON.stringify({ userId: 'user_demo', remember: true }));
      if (storage) window.localStorage.setItem(STORAGE_KEY, storage);
      window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      window.PointerEvent = window.MouseEvent;
      window.Element.prototype.scrollIntoView = function () {};
      window.URL.createObjectURL = () => 'blob:x';
      if (onCook) onCook(window);
    },
  });
  return { dom, errors };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (dom) => {
  const script = dom.window.document.createElement('script');
  script.textContent = code;
  dom.window.document.body.appendChild(script);
};

/* 1. boot once to obtain a real database payload ------------------------- */
console.log('STEP 1 — capture a real database payload');
const first = boot({ url: 'http://localhost/' });
await wait(200);
run(first.dom);
await wait(2500);
let raw = first.dom.window.localStorage.getItem(STORAGE_KEY);
if (!raw) {
  // Nothing has been written yet: pull the live database through the debug hook.
  const exported = first.dom.window.scriptora?.export?.();
  if (exported) raw = JSON.stringify({ version: 9, data: JSON.parse(exported) });
}
check('database available to migrate', Boolean(raw), raw ? `${raw.length} bytes` : 'no payload');
first.dom.window.close();
if (!raw) {
  console.log('\nMIGRATION CHECK: FAIL (no database payload)');
  process.exitCode = 1;
  process.exit(1);
}

/* 2. strip the newer fields, exactly like an old build ------------------- */
console.log('\nSTEP 2 — write an old-shaped database (no canvas / footnotes / textStyles)');
const payload = JSON.parse(raw);
const books = payload.data?.books ?? [];
check('payload contains books', books.length > 0, `${books.length} books`);
for (const book of books) {
  delete book.canvas;
  delete book.footnotes;
  delete book.textStyles;
  if (book.theme) {
    delete book.theme.widowControl;
    delete book.theme.orphanControl;
  }
}
const targetId = books.find((b) => b.id === 'book_keeper_ledger')?.id ?? books[0].id;
check('the editor book no longer has canvas', books.every((book) => book.canvas === undefined));

/* 3. boot the editor on that old data ------------------------------------ */
console.log('\nSTEP 3 — open the editor on the migrated data');
const second = boot({ url: `http://localhost/dashboard/books/${targetId}/editor`, storage: JSON.stringify(payload) });
await wait(200);
run(second.dom);
await wait(3500);
const doc = second.dom.window.document;
// Only the rendered app counts: body.textContent also contains the inline bundle,
// which legitimately holds strings like "Something went wrong on this screen".
const bodyText = doc.getElementById('root')?.textContent || '';

check('no crash screen', !/Something went wrong on this screen/i.test(bodyText), bodyText.slice(0, 120));
if (/Something went wrong on this screen/i.test(bodyText)) {
  const walker = doc.createTreeWalker(doc.getElementById('root') ?? doc.body, 4 /* SHOW_TEXT */);
  const hits = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent || '';
    if (/Something went wrong on this screen/i.test(text)) {
      const ancestors = [];
      let node = walker.currentNode.parentElement;
      for (let depth = 0; node && depth < 6; depth += 1) {
        ancestors.push(`${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ').slice(0, 3).join('.')}`);
        node = node.parentElement;
      }
      hits.push(ancestors.join(' < '));
    }
  }
  console.log('    debug: text-node ancestors =', hits.slice(0, 3));
}
check('no collapsedSections error', !/collapsedSections/i.test(bodyText));
check('editor canvas rendered', Boolean(doc.querySelector('[data-page-id]')));
// open a page that actually has prose (the first page of a chapter)
const pageRows = [...doc.querySelectorAll('button')].filter((b) => /^\d+\./.test(b.textContent || ''));
pageRows[1]?.dispatchEvent(new second.dom.window.MouseEvent('click', { bubbles: true }));
await wait(1200);
const pmText = doc.querySelector('.ProseMirror')?.textContent || '';
check('page text is present', pmText.length > 50, `${pmText.length} chars`);

/* 4. the panels that read the missing fields ----------------------------- */
const clickByText = async (label) => {
  const button = [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === label);
  button?.dispatchEvent(new second.dom.window.MouseEvent('click', { bubbles: true }));
  await wait(600);
};
await clickByText('Chapters');
const chapterButtons = [...doc.querySelectorAll('button[aria-expanded]')];
check('chapter panel lists sections', chapterButtons.length > 0, `${chapterButtons.length} sections`);
chapterButtons[0]?.dispatchEvent(new second.dom.window.MouseEvent('click', { bubbles: true }));
await wait(500);
check('chapter collapse works on migrated data', !/Something went wrong/i.test(doc.getElementById('root')?.textContent || ''));

await clickByText('Pages');
check('pages panel renders', /Drag to reorder/.test(doc.getElementById('root')?.textContent || ''));

/* 5. migration was written back ------------------------------------------ */
console.log('\nSTEP 5 — migrated fields are persisted');
const after = JSON.parse(second.dom.window.localStorage.getItem(STORAGE_KEY) ?? '{}');
const migratedBook = (after.data?.books ?? []).find((book) => book.id === targetId);
check('canvas restored in storage', Boolean(migratedBook?.canvas), migratedBook?.canvas ? JSON.stringify(migratedBook.canvas).slice(0, 80) : 'missing');
check('canvas has the virtualise threshold', migratedBook?.canvas?.virtualizeAfter === 40);
check('footnotes array restored', Array.isArray(migratedBook?.footnotes));
check('textStyles restored', Array.isArray(migratedBook?.textStyles) && migratedBook.textStyles.length > 5, `${migratedBook?.textStyles?.length ?? 0} styles`);

console.log('\nruntime errors:', second.errors.slice(0, 3));
const broken = failures.length > 0 || second.errors.length > 0;
check('no runtime errors', second.errors.length === 0, second.errors[0] ?? '');
second.dom.window.close();

console.log(`\nMIGRATION CHECK: ${broken ? 'FAIL' : 'PASS'}`);
failures.forEach((failure) => console.log('  -', failure));
process.exitCode = broken ? 1 : 0;
