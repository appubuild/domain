/**
 * Headless render test — the fastest way to catch a white screen without a browser.
 *
 * The app is bundled into one classic script (vite.smoke.config.ts → dist-smoke/app.js)
 * and executed inside jsdom, so React really mounts and all repositories/seed data run.
 * Reports thrown errors, console errors, what the page rendered, and can click through
 * SPA navigation.
 *
 * Usage:
 *   node scripts/smoke.mjs [route ...]              # anonymous
 *   SMOKE_AS=demo node scripts/smoke.mjs /dashboard # signed-in author
 *   SMOKE_AS=admin node scripts/smoke.mjs /admin    # signed-in admin
 *   SMOKE_BUILD=1 node scripts/smoke.mjs            # rebuild the smoke bundle first
 *
 * SMOKE_AS pre-seeds the session + database in localStorage before the app boots,
 * which is how the protected routes (dashboard, editor, admin console) get exercised
 * without a real browser.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = process.cwd();
const bundle = path.join(root, 'dist-smoke', 'app.js');
const shellHtml = path.join(root, 'dist-smoke', 'index.html');
const css = path.join(root, 'dist-smoke', 'app.css');

if (process.env.SMOKE_BUILD || !existsSync(bundle)) {
  console.log('building smoke bundle…');
  execSync('npx vite build --config vite.smoke.config.ts', { stdio: 'inherit' });
}

const routes = process.argv.slice(2);
const targetRoutes = routes.length ? routes : ['/'];
const asUser = process.env.SMOKE_AS ?? '';
const SESSION_FOR = { demo: 'user_demo', admin: 'user_admin', moderator: 'user_moderator' };
const code = readFileSync(bundle, 'utf8');
const cssText = existsSync(css) ? readFileSync(css, 'utf8') : '';

const browserShims = `
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
  }
  if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  }
  if (!window.PointerEvent) window.PointerEvent = window.MouseEvent;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
  if (!window.scrollTo) window.scrollTo = function () {};
  URL.createObjectURL = URL.createObjectURL || (() => 'blob:smoke');
  URL.revokeObjectURL = URL.revokeObjectURL || (() => {});
`;

let failures = 0;

for (const route of targetRoutes) {
  const errors = [];
  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (!/Could not (load|parse)/i.test(error.message)) errors.push(`[jsdom] ${error.message}`);
  });
  virtualConsole.on('error', (...args) => consoleErrors.push(args.map(String).join(' ')));
  virtualConsole.on('warn', () => {});

  const html = `<!doctype html><html lang="en"><head><title>smoke</title><style>${cssText}</style></head><body><div id="root"></div></body></html>`;

  const dom = new JSDOM(html, {
    url: `http://localhost${route}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (window) => {
      window.eval(browserShims);
      window.onerror = (message, source, line, column, error) =>
        errors.push(`[window.onerror] ${message}\n${error?.stack ?? ''}`);
      window.addEventListener('unhandledrejection', (event) =>
        errors.push(`[unhandledrejection] ${String(event.reason?.stack ?? event.reason)}`));
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 250));

  if (asUser) {
    const userId = SESSION_FOR[asUser] ?? asUser;
    // Session key mirrors src/store/session.ts; the database itself is seeded by the app.
    dom.window.localStorage.setItem('scriptora.session.v1', JSON.stringify({ userId, remember: true }));
  }

  const script = dom.window.document.createElement('script');
  script.textContent = code;
  dom.window.document.body.appendChild(script);

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const rootEl = dom.window.document.getElementById('root');
  const html2 = rootEl?.innerHTML ?? '';
  const text = (rootEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const white = html2.length < 200;
  if (white || errors.length) failures += 1;

  console.log(`\n=== ${route} ===`);
  console.log(`rendered chars : ${html2.length}`);
  console.log(`first text     : ${text.slice(0, 160) || '(none)'}`);
  console.log(`headings       : ${[...dom.window.document.querySelectorAll('h1,h2')].slice(0, 4).map((el) => el.textContent?.trim()).join(' | ') || '(none)'}`);
  const links = dom.window.document.querySelectorAll('a').length;
  const buttons = dom.window.document.querySelectorAll('button').length;
  console.log(`links/buttons  : ${links} / ${buttons}`);
  console.log(`localStorage   : ${Object.keys(dom.window.localStorage).join(', ') || '(empty)'}`);
  console.log(`signed in as   : ${asUser || '(anonymous)'}`);

  if (errors.length) {
    console.log('--- runtime errors ---');
    for (const error of errors.slice(0, 6)) console.log(error.slice(0, 1500));
  }
  if (consoleErrors.length) {
    console.log(`--- console.error (${consoleErrors.length}) ---`);
    for (const error of consoleErrors.slice(0, 6)) console.log(error.slice(0, 700));
  }
  console.log(`VERDICT: ${white ? 'WHITE SCREEN' : errors.length ? 'RENDERED WITH ERRORS' : 'OK'}`);
  dom.window.close();
}

console.log(`\n${failures === 0 ? 'ALL ROUTES OK' : `${failures} route(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
