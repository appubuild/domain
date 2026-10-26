/* Client-side blog archive: blog-config.json is the publication source of truth. */
(() => {
  'use strict';

  const grid = document.querySelector('[data-blog-grid]');
  if (!grid) return;

  const status = document.querySelector('[data-blog-status]');
  const search = document.querySelector('[data-blog-search]');
  const categoryFilter = document.querySelector('[data-blog-category]');
  const pagination = document.querySelector('[data-blog-pagination]');
  const params = new URLSearchParams(window.location?.search || '');
  const requestedCategory = params.get('category');
  if (categoryFilter && requestedCategory && Array.from(categoryFilter.options || []).some((option) => option.value === requestedCategory)) {
    categoryFilter.value = requestedCategory;
  }

  const PAGE_SIZE = 9;
  const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const SAFE_FILE = /^blog-[a-z0-9-]+\.html$/i;
  const SAFE_IMAGE = /^\/assets\/img\/blog\/feature-[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/i;
  let currentPage = 1;
  let posts = [];

  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.setAttribute('role', isError ? 'alert' : 'status');
  };

  const safeDate = (value) => {
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return value || '';
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  };

  const normalizePost = (post) => {
    if (!post || post.published !== true) return null;
    if (typeof post.id !== 'string' || !post.id.trim()) return null;
    if (typeof post.slug !== 'string' || !SAFE_SLUG.test(post.slug)) return null;
    if (typeof post.title !== 'string' || !post.title.trim()) return null;
    if (typeof post.excerpt !== 'string' || !post.excerpt.trim()) return null;
    if (typeof post.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(post.date)) return null;
    if (!Number.isInteger(Number(post.readTime)) || Number(post.readTime) < 1) return null;
    if (typeof post.file !== 'string' || !SAFE_FILE.test(post.file)) return null;

    const image = typeof post.image === 'string' && SAFE_IMAGE.test(post.image) ? post.image : '';
    const tags = Array.isArray(post.tags)
      ? post.tags.filter((tag) => typeof tag === 'string' && tag.trim()).slice(0, 12)
      : [];
    const category = typeof post.category === 'string' ? post.category.trim() : '';
    return {
      ...post,
      title: post.title.trim(),
      excerpt: post.excerpt.trim(),
      readTime: Number(post.readTime),
      image,
      imageAlt: typeof post.imageAlt === 'string' && post.imageAlt.trim() ? post.imageAlt.trim() : `Illustration for ${post.title.trim()}`,
      tags,
      category
    };
  };

  const makeCard = (post) => {
    const card = document.createElement('article');
    card.className = 'blog-card';
    card.dataset.postId = post.id;

    if (post.image) {
      const media = document.createElement('div');
      media.className = 'blog-card-media';
      const image = document.createElement('img');
      image.src = post.image;
      image.alt = post.imageAlt;
      image.width = 1200;
      image.height = 675;
      image.loading = 'lazy';
      image.decoding = 'async';
      const imageLink = document.createElement('a');
      imageLink.className = 'blog-card-image-link';
      imageLink.href = post.file;
      imageLink.setAttribute('aria-label', `Read: ${post.title}`);
      imageLink.append(image);
      media.append(imageLink);
      card.append(media);
    }

    const body = document.createElement('div');
    body.className = 'blog-card-body';

    const meta = document.createElement('div');
    meta.className = 'blog-card-meta';
    const time = document.createElement('time');
    time.dateTime = post.date;
    time.textContent = safeDate(post.date);
    const readingTime = document.createElement('span');
    readingTime.className = 'blog-card-reading-time';
    readingTime.textContent = `${post.readTime} min read`;
    meta.append(time, readingTime);

    const heading = document.createElement('h2');
    const link = document.createElement('a');
    link.href = post.file;
    link.textContent = post.title;
    heading.append(link);

    const excerpt = document.createElement('p');
    excerpt.textContent = post.excerpt;

    const tags = document.createElement('div');
    tags.className = 'tag-list';
    post.tags.forEach((tagText) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tagText;
      tags.append(tag);
    });

    const readLink = document.createElement('a');
    readLink.className = 'blog-card-link';
    readLink.href = post.file;
    readLink.textContent = 'Read article →';
    readLink.setAttribute('aria-label', `Read: ${post.title}`);

    body.append(meta, heading, excerpt, tags, readLink);
    card.append(body);
    return card;
  };

  const categorySlug = (value) => String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const renderPagination = (totalPages) => {
    if (!pagination) return;
    pagination.hidden = totalPages <= 1;
    if (totalPages <= 1) {
      pagination.replaceChildren();
      return;
    }

    const makeButton = (label, targetPage, { disabled = false, current = false, ariaLabel = label } = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `pagination-button${current ? ' is-current' : ''}`;
      button.textContent = label;
      button.setAttribute('aria-label', ariaLabel);
      if (current) button.setAttribute('aria-current', 'page');
      button.disabled = disabled;
      button.addEventListener('click', () => {
        if (disabled || targetPage === currentPage) return;
        currentPage = targetPage;
        render();
        grid.scrollIntoView?.({ block: 'start' });
      });
      return button;
    };

    const controls = [makeButton('Previous', currentPage - 1, {
      disabled: currentPage === 1,
      ariaLabel: 'Go to previous page'
    })];
    for (let page = 1; page <= totalPages; page += 1) {
      controls.push(makeButton(String(page), page, {
        current: page === currentPage,
        ariaLabel: `Page ${page}`
      }));
    }
    controls.push(makeButton('Next', currentPage + 1, {
      disabled: currentPage === totalPages,
      ariaLabel: 'Go to next page'
    }));

    const summary = document.createElement('span');
    summary.className = 'pagination-summary';
    summary.setAttribute('aria-live', 'polite');
    summary.textContent = `Page ${currentPage} of ${totalPages}`;
    pagination.replaceChildren(...controls, summary);
  };

  const render = () => {
    const query = (search?.value || '').trim().toLowerCase();
    const selectedCategory = categoryFilter?.value || '';
    const filtered = posts.filter((post) => {
      const postCategory = post.category || post.tags[0] || '';
      const categoryMatches = !selectedCategory || categorySlug(postCategory) === selectedCategory;
      const searchable = [post.title, post.excerpt, post.category, ...post.tags]
        .filter(Boolean).join(' ').toLowerCase();
      return categoryMatches && searchable.includes(query);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const firstIndex = (currentPage - 1) * PAGE_SIZE;
    const visiblePosts = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);
    grid.replaceChildren(...visiblePosts.map(makeCard));
    renderPagination(totalPages);
    window.DomainFitsReveal?.(grid);

    if (filtered.length === 0) {
      const hasFilter = query || selectedCategory;
      setStatus(hasFilter ? 'No published articles match those filters. Try another keyword or category.' : 'There are no published articles yet.', false);
    } else {
      const lastIndex = Math.min(firstIndex + PAGE_SIZE, filtered.length);
      setStatus(`Showing ${firstIndex + 1}–${lastIndex} of ${filtered.length} published ${filtered.length === 1 ? 'article' : 'articles'}.`, false);
    }
  };

  search?.addEventListener('input', () => {
    currentPage = 1;
    render();
  });
  categoryFilter?.addEventListener('change', () => {
    currentPage = 1;
    render();
  });
  setStatus('Loading published articles…');

  fetch('./blog-config.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load blog config (${response.status}).`);
      return response.json();
    })
    .then((config) => {
      if (!config || config.schemaVersion !== 1 || !Array.isArray(config.posts)) {
        throw new Error('The blog config has an unsupported format.');
      }
      const seenIds = new Set();
      const seenSlugs = new Set();
      posts = config.posts
        .filter((post) => post && post.published === true)
        .map(normalizePost)
        .filter((post) => {
          if (!post || seenIds.has(post.id) || seenSlugs.has(post.slug)) return false;
          seenIds.add(post.id);
          seenSlugs.add(post.slug);
          return true;
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const availableCategories = new Set(posts.map((post) => categorySlug(post.category || post.tags[0] || '')));
      if (categoryFilter) {
        Array.from(categoryFilter.options || []).forEach((option) => {
          if (option.value) option.hidden = !availableCategories.has(option.value);
        });
      }
      document.querySelectorAll('[data-blog-category-link]').forEach((link) => {
        link.hidden = !availableCategories.has(link.dataset.blogCategoryLink || '');
      });
      render();
    })
    .catch((error) => {
      grid.replaceChildren();
      setStatus('The published article list could not be loaded. Please refresh or use the article links in the site navigation.', true);
      console.error('DomainFits blog:', error);
    });
})();
