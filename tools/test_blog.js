'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'assets/js/blog.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'blog/blog-config.json'), 'utf8'));
const packageConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const capacitorConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(ROOT, 'assets/js/main.js'), 'utf8');
const themeBridgeSource = fs.readFileSync(path.join(ROOT, 'assets/js/capacitor-theme-sync.js'), 'utf8');
const androidStrings = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/strings.xml'), 'utf8');
const androidLauncherIcon = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
const androidAppGradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const androidCapacitorGradle = fs.readFileSync(path.join(ROOT, 'android/app/capacitor.build.gradle'), 'utf8');
const androidVariables = fs.readFileSync(path.join(ROOT, 'android/variables.gradle'), 'utf8');
const androidInstrumentationTest = fs.readFileSync(path.join(ROOT, 'android/app/src/androidTest/java/com/domainfits/app/ExampleInstrumentedTest.java'), 'utf8');
const androidColors = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/colors.xml'), 'utf8');
const generatorSource = fs.readFileSync(path.join(ROOT, 'assets/js/domain-generator.js'), 'utf8');
const generatorHtml = fs.readFileSync(path.join(ROOT, 'tools/domain-generator.html'), 'utf8');
const generatorCss = fs.readFileSync(path.join(ROOT, 'assets/css/style.css'), 'utf8');
const domainDataSource = fs.readFileSync(path.join(ROOT, 'assets/js/domain-generator-data.js'), 'utf8');
const domainDataContext = {};
vm.runInNewContext(`${domainDataSource}\nglobalThis.__testData = { longPartnerWords: LONG_PARTNER_WORDS, categoryKeys: Object.keys(CATEGORY_KEYWORDS) };`, domainDataContext);
const { longPartnerWords, categoryKeys } = domainDataContext.__testData;

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.values.has(name) : Boolean(force);
    if (shouldAdd) this.values.add(name);
    else this.values.delete(name);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.options = [];
    this.subqueries = new Map();
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.classList = new FakeClassList();
    this.hidden = false;
    this.disabled = false;
    this.isFragment = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children.flatMap((child) => child?.isFragment ? child.children : [child]); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type) { for (const callback of this.listeners[type] || []) callback({ target: this }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  querySelector(selector) {
    if (!this.subqueries.has(selector)) this.subqueries.set(selector, new FakeElement('span'));
    return this.subqueries.get(selector);
  }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
}

async function render(configData, { category = '', search = '' } = {}) {
  const grid = new FakeElement('div');
  const status = new FakeElement('p');
  const searchInput = new FakeElement('input');
  searchInput.value = search;
  const categoryFilter = new FakeElement('select');
  categoryFilter.value = category;
  categoryFilter.options = [
    { value: '' },
    { value: 'domain-fundamentals' },
    { value: 'ai-and-emerging-web', hidden: true },
    { value: 'web-infrastructure-and-apis', hidden: true },
    { value: 'security-and-reliability', hidden: true }
  ];
  const pagination = new FakeElement('nav');
  const categoryLinks = [
    new FakeElement('a'), new FakeElement('a'), new FakeElement('a')
  ];
  categoryLinks[0].dataset.blogCategoryLink = 'ai-and-emerging-web';
  categoryLinks[1].dataset.blogCategoryLink = 'web-infrastructure-and-apis';
  categoryLinks[2].dataset.blogCategoryLink = 'security-and-reliability';
  const elements = {
    '[data-blog-grid]': grid,
    '[data-blog-status]': status,
    '[data-blog-search]': searchInput,
    '[data-blog-category]': categoryFilter,
    '[data-blog-pagination]': pagination
  };
  const document = {
    querySelector: (selector) => elements[selector] || null,
    querySelectorAll: (selector) => selector === '[data-blog-category-link]' ? categoryLinks : [],
    createElement: (tag) => new FakeElement(tag)
  };
  const window = { location: { search: '' }, DomainFitsReveal: null };
  const fetch = async (url, options) => {
    assert.equal(url, './blog-config.json');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => configData };
  };
  vm.runInNewContext(source, { document, window, fetch, URLSearchParams, Intl, Date, console });
  await new Promise((resolve) => setImmediate(resolve));
  return { grid, status, searchInput, categoryFilter, pagination, categoryLinks };
}

async function runPublishGuard(configData, post) {
  const guardSource = fs.readFileSync(path.join(ROOT, 'assets/js/blog-publish-guard.js'), 'utf8');
  const article = new FakeElement('div');
  article.dataset.postSlug = post.slug;
  article.hidden = true;
  const notice = new FakeElement('section');
  const cta = new FakeElement('section');
  cta.hidden = true;
  const robots = { content: 'noindex,nofollow' };
  const document = {
    querySelector: (selector) => ({
      '[data-publish-guard]': article,
      '[data-draft-notice]': notice,
      '[data-publish-guard-cta]': cta,
      'meta[name="robots"]': robots
    })[selector] || null
  };
  const window = { location: { pathname: `/blog/${post.file}` } };
  const fetch = async (url, options) => {
    assert.equal(url, '/blog/blog-config.json');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => configData };
  };
  vm.runInNewContext(guardSource, { document, window, fetch, console });
  await new Promise((resolve) => setImmediate(resolve));
  return { article, notice, cta, robots };
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function runGenerator({ root = 'Domain', lengths = [3], category = 'smart', placement = 'both', strict = true, brandable = false, controlMode = 'drawer', viewportWidth = 390 } = {}) {
  const ids = new Map();
  for (const [, id] of generatorHtml.matchAll(/\bid="([^"]+)"/g)) {
    if (!ids.has(id)) ids.set(id, new FakeElement('input'));
  }
  const element = (id) => {
    if (!ids.has(id)) ids.set(id, new FakeElement('div'));
    return ids.get(id);
  };
  element('rootInput').value = root;
  element('extInput').value = '.com';
  element('brainModeSelect').value = category;
  element('placementSelect').value = placement;
  element('customCountInput').value = '80';
  element('countPresetSelect').value = 'custom';
  element('strictDictToggle').checked = strict;
  element('brandableModeToggle').checked = brandable;
  element('generatorSettingsAccordionToggle').setAttribute('aria-expanded', 'true');
  element('generatorSettingsFab').setAttribute('aria-expanded', 'false');
  element('exportMenuToggle').setAttribute('aria-expanded', 'false');
  element('exportSpeedMenu').hidden = true;
  element('settingsBackdrop').hidden = true;
  element('camelCaseToggle').checked = true;
  element('inSearchInput').value = '';
  const lengthInputs = [2, 3, 4, 5, 6, 7].map((value) => element(`len${value}`));
  lengthInputs.forEach((input, index) => { input.value = String(index + 2); });
  lengths.forEach((value) => { element(`len${value}`).checked = true; });

  const document = {
    readyState: 'complete',
    body: new FakeElement('body'),
    getElementById: element,
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment: () => {
      const fragment = new FakeElement('#fragment');
      fragment.isFragment = true;
      return fragment;
    },
    querySelectorAll: (selector) => {
      if (selector === '.len-checkbox:checked') return lengthInputs.filter((input) => input.checked);
      if (selector === '.len-checkbox') return lengthInputs;
      return [];
    }
  };
  const window = {
    listeners: {},
    innerWidth: viewportWidth,
    matchMedia() { return { matches: this.innerWidth <= 740 }; },
    DOMAINFITS_SITE_CONFIG: { generatorControlsMode: controlMode },
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
    dispatch(type) { for (const callback of this.listeners[type] || []) callback({ type }); },
    requestAnimationFrame: (callback) => { callback(); return 1; },
    clearTimeout: () => {},
    setTimeout: (callback) => { callback(); return 1; }
  };
  vm.runInNewContext(`${domainDataSource}\n${generatorSource}`, { document, window, console, navigator: {} });
  return { grid: element('domainGrid'), elements: ids, window, document };
}

(async () => {
  assert.equal(capacitorConfig.appId, 'com.domainfits.app');
  assert.equal(capacitorConfig.appName, 'DomainFits');
  assert.equal(capacitorConfig.webDir, 'www');
  assert.equal(capacitorConfig.server?.url, undefined, 'the Android app must not load a hosted WebView URL');
  assert.equal(packageConfig.dependencies['@capawesome/capacitor-navigation-bar'], '^8.0.2');
  assert.ok(packageConfig.dependencies['@capacitor/status-bar']);
  assert.match(mainSource, /domainfits:themechange/);
  assert.match(themeBridgeSource, /StatusBar\.setBackgroundColor/);
  assert.match(themeBridgeSource, /StatusBar\.setStyle/);
  assert.match(themeBridgeSource, /NavigationBar\.setColor/);
  assert.match(themeBridgeSource, /NavigationBar\.setStyle/);
  assert.match(androidStrings, /<string name="app_name">DomainFits<\/string>/);
  assert.match(androidLauncherIcon, /@drawable\/ic_launcher_foreground/);
  assert.match(androidLauncherIcon, /@drawable\/ic_launcher_monochrome/);
  assert.match(androidColors, /#5946E8/i);
  assert.match(androidAppGradle, /applicationId "com\.domainfits\.app"/);
  assert.match(androidCapacitorGradle, /JavaVersion\.VERSION_21/);
  assert.match(androidVariables, /minSdkVersion = 24[\s\S]*compileSdkVersion = 36[\s\S]*targetSdkVersion = 36/);
  assert.match(androidInstrumentationTest, /assertEquals\("com\.domainfits\.app"/);
  assert.ok(fs.statSync(path.join(ROOT, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png')).size > 5000);

  const webRoot = path.join(ROOT, capacitorConfig.webDir);
  const bundledFiles = listFiles(webRoot);
  const htmlFiles = bundledFiles.filter((file) => file.toLowerCase().endsWith('.html'));
  assert.ok(htmlFiles.length >= 50, 'the local app bundle should include the full site');
  assert.ok(fs.existsSync(path.join(webRoot, 'assets/js/capacitor-theme-sync.bundle.js')));
  assert.equal(bundledFiles.filter((file) => file.toLowerCase().endsWith('.md')).length, 0, 'editorial Markdown must stay out of the app bundle');
  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    assert.match(html, /capacitor-theme-sync\.bundle\.js/);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']https?:\/\//i, 'runtime JavaScript must be local');
    for (const [linkTag] of html.matchAll(/<link\b[^>]*>/gi)) {
      if (/\brel=["'](?:stylesheet|preload|modulepreload)/i.test(linkTag)) {
        assert.doesNotMatch(linkTag, /\bhref=["']https?:\/\//i, 'runtime stylesheets must be local');
      }
    }
    for (const [, title] of html.matchAll(/<title[^>]*>(.*?)<\/title>/gis)) {
      assert.match(title, /DomainFits/);
    }
  }

  assert.match(generatorHtml, /id="len7" value="7"[^>]*><span[^>]*>.*?7\+ letters/s);
  assert.match(generatorSource, /const LENGTHS = \[2, 3, 4, 5, 6, 7\]/);
  assert.match(generatorSource, /length === 7 \? word\.length >= 7 : word\.length === length/);
  assert.match(generatorSource, /const lengthTier = partnerLength >= 6 \? 6 : partnerLength/);
  assert.match(generatorSource, /\$\{partnerKind\}: \$\{partnerLength\} letters\. Total domain label: \$\{labelLength\} characters/);
  assert.ok(longPartnerWords.length >= 80, 'the 7+ filter should have a useful supplemental partner-word pool');
  assert.ok(longPartnerWords.every((word) => word.length >= 7), 'every supplemental partner word must be at least seven letters');
  assert.equal(new Set(longPartnerWords).size, longPartnerWords.length, 'supplemental partner words should not be duplicated');
  for (const category of ['tech_ai', 'fintech', 'ecommerce', 'health_bio', 'creative_media', 'saas_action', 'minimal_short']) {
    assert.ok(categoryKeys.includes(category), `missing niche word-pool category: ${category}`);
    assert.match(generatorHtml, new RegExp(`value="${category}"`), `missing selector option for ${category}`);
  }
  assert.match(generatorHtml, /id="brandableModeToggle"(?![^>]*checked)[^>]*>/, 'Brandable Mode must default off');
  assert.match(generatorHtml, /domain-generator-data\.js\?v=20261024-1/);
  assert.match(generatorHtml, /domain-generator\.js\?v=20261024-3/);
  assert.match(generatorHtml, /class="mode-switches"/);
  assert.match(generatorCss, /\.mode-switches \{ display: grid/);
  assert.match(generatorCss, /@media \(max-width: 520px\)[\s\S]*?\.mode-switches \{ grid-template-columns: 1fr/);
  assert.match(generatorSource, /function generateBrandableDomains/);
  assert.match(generatorSource, /BRANDABLE_MORPHEMES = \['ly', 'io', 'ify', 'eer', 'via', 'nest', 'tify'/);
  assert.match(generatorSource, /const brandableMode = \$\('brandableModeToggle'\)\.checked/);

  const fintechCase = runGenerator({ root: 'pay', lengths: [4], category: 'fintech', placement: 'prefix' });
  const fintechNames = fintechCase.grid.children.map((card) => card.dataset.domain);
  assert.ok(fintechNames.includes('PayCash.com'));
  assert.ok(fintechNames.includes('PayCoin.com'));
  assert.ok(fintechNames.includes('PayFund.com'));

  const strictCase = runGenerator({ root: 'Domain', lengths: [3] });
  assert.equal(strictCase.elements.get('strictStatusBadge').textContent, 'On');
  strictCase.elements.get('strictDictToggle').checked = false;
  strictCase.elements.get('strictDictToggle').dispatch('input');
  assert.equal(strictCase.elements.get('strictStatusBadge').textContent, 'Off');
  assert.ok(strictCase.elements.get('strictBanner').classList.contains('is-creative'));

  const brandableCase = runGenerator({ root: 'Domain', lengths: [3] });
  assert.equal(brandableCase.elements.get('brandableModeBadge').textContent, 'Off');
  brandableCase.elements.get('brandableModeToggle').checked = true;
  brandableCase.elements.get('brandableModeToggle').dispatch('input');
  brandableCase.elements.get('brandableModeToggle').dispatch('change');
  assert.equal(brandableCase.elements.get('brandableModeBadge').textContent, 'On');
  assert.ok(brandableCase.elements.get('brandableModePanel').classList.contains('is-active'));
  const brandableCards = brandableCase.grid.children;
  const domainify = brandableCards.find((card) => card.dataset.domain === 'Domainify.com');
  const domaineer = brandableCards.find((card) => card.dataset.domain === 'Domaineer.com');
  assert.ok(domainify, 'Brandable Mode should make the Domain + ify morphology');
  assert.ok(domaineer, 'Brandable Mode should make the Domain + eer morphology');
  const domainifyBadge = domainify.children[1].children[0];
  assert.equal(domainifyBadge.dataset.partnerLength, '3');
  assert.equal(domainifyBadge.dataset.labelLength, '9');
  assert.match(domainifyBadge.title, /partner component: 3 letters.*Total domain label: 9 characters/);

  const restoredBrandable = runGenerator({ root: 'Domain', lengths: [3] });
  restoredBrandable.elements.get('brandableModeToggle').checked = true;
  restoredBrandable.window.dispatch('pageshow');
  assert.equal(restoredBrandable.elements.get('brandableModeBadge').textContent, 'On', 'restored checkbox state should refresh the UI');
  assert.ok(restoredBrandable.grid.children.some((card) => card.dataset.domain === 'Domainify.com'));

  const longRun = runGenerator({ root: 'Pay', lengths: [7] });
  assert.ok(longRun.grid.children.length > 0, 'the 7+ option should generate actual results');
  assert.ok(longRun.grid.children.every((card) => Number(card.children[1].children[0].dataset.partnerLength) >= 7));

  const drawerCase = runGenerator({ controlMode: 'drawer' });
  assert.equal(drawerCase.elements.get('main-content').dataset.controlsMode, 'drawer');
  assert.equal(drawerCase.elements.get('generator').getAttribute('aria-hidden'), 'true', 'the closed drawer is removed from the accessibility tree');
  drawerCase.elements.get('generatorSettingsFab').click();
  assert.ok(drawerCase.elements.get('generator').classList.contains('is-open'));
  assert.equal(drawerCase.elements.get('generator').getAttribute('aria-modal'), 'true');
  assert.equal(drawerCase.elements.get('settingsBackdrop').hidden, false);
  assert.ok(drawerCase.document.body.classList.contains('generator-drawer-open'));
  drawerCase.elements.get('generateBtn').click();
  assert.ok(!drawerCase.elements.get('generator').classList.contains('is-open'), 'Generate closes the settings drawer');
  assert.equal(drawerCase.elements.get('settingsBackdrop').hidden, true);
  assert.ok(drawerCase.elements.get('generatedResults').scrolledIntoView, 'Generate brings results into view');
  assert.equal(drawerCase.elements.get('btnCountBadge').textContent, String(drawerCase.grid.children.length));
  assert.equal(drawerCase.elements.get('mobileBtnCountBadge').textContent, String(drawerCase.grid.children.length));

  const desktopCase = runGenerator({ controlMode: 'drawer', viewportWidth: 1280 });
  assert.equal(desktopCase.elements.get('generator').getAttribute('aria-hidden'), 'false', 'desktop keeps the original inline settings panel visible');
  assert.equal(desktopCase.elements.get('generator').inert, false, 'desktop settings remain interactive');
  assert.equal(desktopCase.elements.get('generatorSettingsFab').hidden, true, 'the mobile settings FAB is hidden on desktop');
  assert.equal(desktopCase.elements.get('settingsBackdrop').hidden, true, 'desktop does not open a modal backdrop');
  desktopCase.elements.get('generateBtn').click();
  assert.equal(desktopCase.elements.get('generatedResults').scrolledIntoView, undefined, 'desktop generation keeps the original page flow');
  desktopCase.window.innerWidth = 390;
  desktopCase.window.dispatch('resize');
  assert.equal(desktopCase.elements.get('generator').getAttribute('aria-hidden'), 'true', 'resizing to mobile activates the closed drawer state');
  assert.equal(desktopCase.elements.get('generatorSettingsFab').hidden, false);
  desktopCase.elements.get('generatorSettingsFab').click();
  desktopCase.window.innerWidth = 1280;
  desktopCase.window.dispatch('resize');
  assert.equal(desktopCase.elements.get('generator').getAttribute('aria-hidden'), 'false', 'resizing back to desktop restores inline controls');
  assert.equal(desktopCase.elements.get('generator').inert, false);
  assert.equal(desktopCase.elements.get('generatorSettingsFab').hidden, true);

  const accordionCase = runGenerator({ controlMode: 'accordion' });
  assert.equal(accordionCase.elements.get('main-content').dataset.controlsMode, 'accordion');
  assert.equal(accordionCase.elements.get('generator').getAttribute('aria-hidden'), 'false');
  assert.equal(accordionCase.elements.get('generatorSettingsFab').hidden, true, 'the drawer FAB is not shown in accordion mode');
  accordionCase.elements.get('generatorSettingsAccordionToggle').click();
  assert.equal(accordionCase.elements.get('generatorSettingsAccordionToggle').getAttribute('aria-expanded'), 'false');
  assert.ok(accordionCase.elements.get('generator').classList.contains('is-collapsed'));
  accordionCase.elements.get('generatorSettingsAccordionToggle').click();
  assert.equal(accordionCase.elements.get('generatorSettingsAccordionToggle').getAttribute('aria-expanded'), 'true');
  assert.ok(!accordionCase.elements.get('generator').classList.contains('is-collapsed'));

  const normal = JSON.parse(JSON.stringify(config));
  const base = await render(normal);
  assert.equal(base.grid.children.length, 9, 'default archive page should contain nine live posts');
  assert.match(base.status.textContent, /of 32 published articles/);
  assert.equal(base.pagination.hidden, false);
  assert.equal(base.pagination.children.at(-1).textContent, 'Page 1 of 4');
  assert.equal(base.categoryFilter.options.find((option) => option.value === 'ai-and-emerging-web').hidden, true);
  assert.equal(base.categoryLinks[0].hidden, true, 'empty draft-only category should stay hidden');
  assert.equal(base.grid.children.some((card) => card.dataset.postId === 'day-31'), false);

  const pageFour = base.pagination.children.find((button) => button.textContent === '4');
  pageFour.click();
  assert.equal(base.grid.children.length, 5, 'last page should show only five of thirty-two articles');
  assert.equal(base.pagination.children.at(-1).textContent, 'Page 4 of 4');

  const published = JSON.parse(JSON.stringify(config));
  const day31 = published.posts.find((post) => post.day === 31);
  day31.published = true;
  const aiArchive = await render(published, { category: 'ai-and-emerging-web' });
  assert.equal(aiArchive.grid.children.length, 1, 'newly published category should show its article');
  assert.equal(aiArchive.grid.children[0].dataset.postId, day31.id);
  assert.equal(aiArchive.categoryFilter.options.find((option) => option.value === 'ai-and-emerging-web').hidden, false);
  assert.equal(aiArchive.categoryLinks[0].hidden, false);
  const cardBody = aiArchive.grid.children[0].children.find((child) => child.className === 'blog-card-body');
  const titleLink = cardBody.children.find((child) => child.tagName === 'h2').children[0];
  assert.equal(titleLink.href, day31.file);
  assert.equal(titleLink.textContent, day31.title);

  const invalidBoolean = JSON.parse(JSON.stringify(config));
  invalidBoolean.posts.find((post) => post.day === 31).published = 'true';
  const strict = await render(invalidBoolean);
  assert.match(strict.status.textContent, /of 32 published articles/, 'string "true" must not publish a draft');

  const draftPage = await runPublishGuard(normal, day31);
  assert.equal(draftPage.article.hidden, true);
  assert.equal(draftPage.notice.hidden, false);
  assert.equal(draftPage.robots.content, 'noindex,nofollow');
  const livePage = await runPublishGuard(published, day31);
  assert.equal(livePage.article.hidden, false);
  assert.equal(livePage.notice.hidden, true);
  assert.equal(livePage.cta.hidden, false);
  assert.equal(livePage.robots.content, 'index,follow,max-image-preview:large');
  console.log('PASS: niche pools, word-length filters/tooltips, published-only blog rendering, pagination, and responsive drawer/accordion controls.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
