'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'assets/js/blog.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'blog/blog-config.json'), 'utf8'));

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.options = [];
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type) { for (const callback of this.listeners[type] || []) callback({ target: this }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  scrollIntoView() {}
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
  const window = { location: { search: '' }, DomainCraftReveal: null };
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

(async () => {
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
  console.log('PASS: published-only rendering, 9-card pagination, category visibility, article gate, SEO state, and strict booleans.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
