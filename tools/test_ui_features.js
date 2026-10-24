'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const siteConfigSource = read('assets/js/site-config.js');
const adsConfigSource = read('assets/js/ads-config.js');
const platformSource = read('assets/js/platform.js');
const adManagerSource = read('assets/js/ad-manager.js');
const mainSource = read('assets/js/main.js');
const pwaSource = read('assets/js/pwa.js');
const buildSource = read('tools/build-app.mjs');
const generatorHtml = read('tools/domain-generator.html');
const generatorSource = read('assets/js/domain-generator.js');
const styleSource = read('assets/css/style.css');
const serviceWorkerSource = read('service-worker.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function getPlatform({ protocol = 'https:', userAgent = '', userAgentData, maxTouchPoints = 0, matchesMobile = false, capacitor } = {}) {
  const listeners = {};
  const window = {
    location: { protocol, hostname: 'domainfits.example' },
    Capacitor: capacitor,
    matchMedia: () => ({ matches: matchesMobile }),
    addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach((callback) => callback(event)); }
  };
  const navigator = { userAgent, userAgentData, maxTouchPoints };
  vm.runInNewContext(platformSource, { window, navigator, CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } } });
  return window.DomainFitsPlatform.detect();
}

function makeSlot(name = 'header-banner') {
  const classValues = new Set();
  return {
    dataset: { adSlot: name },
    hidden: false,
    attributes: {},
    children: [],
    classList: {
      add(value) { classValues.add(value); },
      remove(value) { classValues.delete(value); },
      contains(value) { return classValues.has(value); }
    },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; }
  };
}

function runAdManager({ native = false, config, gated = false } = {}) {
  const slot = makeSlot();
  const listeners = {};
  const scripts = [];
  let createdElements = 0;
  let pushCount = 0;
  const queue = [];
  queue.push = () => { pushCount += 1; return pushCount; };
  const content = {
    querySelectorAll() { return []; },
    querySelector(selector) { return selector === 'ins.adsbygoogle' ? {} : null; },
    cloneNode() { return this; }
  };
  const document = {
    head: { appendChild(script) { scripts.push(script); } },
    querySelectorAll(selector) { return selector === '[data-ad-slot]' ? [slot] : []; },
    querySelector(selector) {
      if (selector === '[data-publish-guard]') return gated ? { hidden: true } : null;
      if (selector === 'script[data-domainfits-ads-loader]') return scripts[0] || null;
      return null;
    },
    createElement(tag) {
      createdElements += 1;
      if (tag === 'template') {
        return { content, set innerHTML(value) { this.markup = value; }, get innerHTML() { return this.markup || ''; } };
      }
      if (tag === 'script') {
        return { dataset: {}, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; } };
      }
      throw new Error(`Unexpected element type ${tag}`);
    }
  };
  const window = {
    location: { protocol: 'https:' },
    DomainFitsPlatform: { isNative: () => native },
    DOMAINFITS_AD_CONFIG: config,
    adsbygoogle: queue,
    addEventListener(type, callback) { (listeners[type] ||= []).push(callback); }
  };
  vm.runInNewContext(adManagerSource, { window, document, console, encodeURIComponent, Array, String, Boolean });
  return { slot, listeners, scripts, createdElements, get pushCount() { return pushCount; } };
}

(() => {
  const configWindow = {};
  vm.runInNewContext(siteConfigSource, { window: configWindow });
  assert.equal(configWindow.DOMAINFITS_SITE_CONFIG.generatorControlsMode, 'drawer');
  assert.match(siteConfigSource, /accordion.*drawer/, 'the central config documents the alternate accordion mode');

  const adsWindow = {};
  vm.runInNewContext(adsConfigSource, { window: adsWindow });
  const adConfig = adsWindow.DOMAINFITS_AD_CONFIG;
  assert.equal(adConfig.enabled, true, 'web ad management is ready to activate after real IDs and units are supplied');
  assert.equal(adConfig.publisherId, '', 'no placeholder publisher ID may make a live request');
  assert.deepEqual(Object.keys(adConfig.slots).sort(), ['article-inline', 'generator-inline', 'header-banner']);
  assert.ok(Object.values(adConfig.slots).every((slot) => slot.code === ''), 'all ad unit markup ships empty');

  assert.match(mainSource, /function syncBrowserChrome/);
  assert.match(mainSource, /updateMetaContent\('theme-color', color\)/);
  assert.match(mainSource, /browserChromeColors = Object\.freeze\(\{ light: '#f7f8fc', dark: '#10121b' \}\)/);
  assert.match(mainSource, /apple-mobile-web-app-status-bar-style/);
  assert.match(pwaSource, /serviceWorker\.register\('\/service-worker\.js'/);
  assert.match(pwaSource, /native \|\| !\('serviceWorker' in navigator\)/);

  assert.equal(manifest.name, 'DomainFits — Domain Name Ideas');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#f7f8fc');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
  for (const icon of manifest.icons) {
    const file = path.join(ROOT, icon.src.slice(1));
    const data = fs.readFileSync(file);
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${icon.src} must be a valid PNG`);
    assert.equal(data.readUInt32BE(16), Number.parseInt(icon.sizes, 10));
    assert.equal(data.readUInt32BE(20), Number.parseInt(icon.sizes, 10));
  }
  assert.match(serviceWorkerSource, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorkerSource, /request\.mode === 'navigate'/);
  assert.match(serviceWorkerSource, /domainfits-pwa-v1/);

  assert.match(generatorHtml, /data-controls-mode="drawer"/);
  assert.match(generatorHtml, /id="generatorSettingsFab"/);
  assert.match(generatorHtml, /id="settingsBackdrop"/);
  assert.match(generatorHtml, /id="generatorSettingsAccordionToggle"/);
  assert.match(generatorHtml, /id="exportMenuToggle"/);
  assert.match(generatorHtml, /id="copyAllMobileBtn"/);
  assert.match(generatorHtml, /id="exportTxtMobileBtn"/);
  assert.match(generatorHtml, /id="exportCsvMobileBtn"/);
  assert.match(generatorSource, /function generateFromSettings/);
  assert.match(generatorSource, /results\.scrollIntoView/);
  assert.match(generatorSource, /mobileBtnCountBadge/);
  assert.match(styleSource, /\.generator-main\[data-controls-mode="drawer"\] \.generator-panel\.is-open/);
  assert.match(styleSource, /@media \(max-width: 740px\)[\s\S]*?\.generator-main\[data-controls-mode="drawer"\] \.generator-panel \{ position: fixed/);
  assert.match(styleSource, /@media \(max-width: 740px\)[\s\S]*?\.export-speed-dial/);
  assert.match(styleSource, /@media \(max-width: 520px\)[\s\S]*?\.domain-grid \{ grid-template-columns: repeat\(2/);

  const nativePlatform = getPlatform({ capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } });
  assert.equal(nativePlatform.kind, 'capacitor-native');
  assert.equal(nativePlatform.platform, 'android');
  const mobilePlatform = getPlatform({ userAgentData: { mobile: true } });
  assert.equal(mobilePlatform.kind, 'mobile-web');
  const desktopPlatform = getPlatform({ userAgentData: { mobile: false }, matchesMobile: false });
  assert.equal(desktopPlatform.kind, 'desktop-web');

  // Reuse the repository's explicit all-zero starter placeholder only inside this isolated VM test.
  const configuredAdsFixture = {
    enabled: true,
    publisherId: 'ca-pub-0000000000000000',
    slots: { 'header-banner': { code: '<ins class="adsbygoogle"></ins>' } }
  };
  const nativeAds = runAdManager({ native: true, config: configuredAdsFixture });
  assert.equal(nativeAds.slot.hidden, true);
  assert.equal(nativeAds.createdElements, 0, 'native mode must not create an AdSense loader or render markup');
  const emptyWebAds = runAdManager({ config: adConfig });
  assert.equal(emptyWebAds.slot.hidden, true);
  assert.equal(emptyWebAds.scripts.length, 0, 'empty central config must not make a request');
  const activeWebAds = runAdManager({ config: configuredAdsFixture });
  assert.equal(activeWebAds.slot.hidden, false);
  assert.equal(activeWebAds.slot.attributes['data-ad-rendered'], 'true');
  assert.equal(activeWebAds.scripts.length, 1, 'the loader is inserted once');
  assert.equal(activeWebAds.pushCount, 1, 'the configured responsive slot is initialized once');
  const gatedAds = runAdManager({ config: configuredAdsFixture, gated: true });
  assert.equal(gatedAds.createdElements, 0, 'unpublished gated articles must not initialize ads');
  gatedAds.listeners['domainfits:publicationchange'][0]({ detail: { published: true } });
  assert.equal(gatedAds.slot.hidden, false, 'the slot becomes available only after the article is published');

  const sitePages = walk(ROOT).filter((file) => file.endsWith('.html'))
    .filter((file) => !file.split(path.sep).some((part) => ['.git', 'android', 'node_modules', 'www'].includes(part)))
    .filter((file) => !file.includes(`${path.sep}includes${path.sep}`))
    .filter((file) => !file.endsWith(`${path.sep}offline.html`));
  assert.ok(sitePages.length >= 60);
  for (const file of sitePages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<meta name="theme-color" content="#f7f8fc">/, `${file}: missing initial theme color`);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, `${file}: missing PWA manifest`);
    for (const script of ['site-config.js', 'ads-config.js', 'platform.js', 'ad-manager.js', 'pwa.js']) {
      assert.match(html, new RegExp(`<script src="/assets/js/${script}`), `${file}: missing ${script}`);
    }
    assert.equal((html.match(/data-ad-slot="header-banner"/g) || []).length, 1, `${file}: header slot should be unique`);
  }

  const blogPages = sitePages.filter((file) => new RegExp(`${path.sep}blog${path.sep}blog-\\d+\\.html$`).test(file));
  assert.equal(blogPages.length, 52);
  for (const file of blogPages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.equal((html.match(/data-ad-slot="article-inline"/g) || []).length, 1, `${file}: article slot should be unique`);
  }
  const generator = read('tools/domain-generator.html');
  assert.equal((generator.match(/data-ad-slot="generator-inline"/g) || []).length, 1);
  assert.ok(fs.existsSync(path.join(ROOT, 'offline.html')));

  const webRoot = path.join(ROOT, 'www');
  if (fs.existsSync(webRoot)) {
    const nativeAdsConfig = fs.readFileSync(path.join(webRoot, 'assets/js/ads-config.js'), 'utf8');
    const nativeAdManager = fs.readFileSync(path.join(webRoot, 'assets/js/ad-manager.js'), 'utf8');
    assert.match(nativeAdsConfig, /enabled:\s*false/);
    assert.doesNotMatch(nativeAdsConfig, /ca-pub-\d+/);
    assert.match(nativeAdManager, /Native-safe stub/);
    assert.doesNotMatch(nativeAdManager, /pagead\.googlesyndication\.com/);
    assert.match(buildSource, /NATIVE_AD_MANAGER/);
  }

  console.log('PASS: theme-color/PWA, platform detection, web-only centralized ad slots, native AdSense stripping, generator control/export UI, and article slot templates.');
})();
