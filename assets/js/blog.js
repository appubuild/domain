/* Client-side static blog archive powered by blog/posts-manifest.json. */
(() => {
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

  const makeCard = (post) => {
    const card = document.createElement('article');
    card.className = 'blog-card';
    const imagePath = typeof post.image === 'string' && /^\/assets\/img\/blog\/[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/i.test(post.image)
      ? post.image
      : '';
    if (imagePath) {
      const media = document.createElement('div');
      media.className = 'blog-card-media';
      const image = document.createElement('img');
      image.src = imagePath;
      image.alt = typeof post.imageAlt === 'string' ? post.imageAlt : `Illustration for ${post.title}`;
      image.width = 1200;
      image.height = 675;
      image.loading = 'lazy';
      image.decoding = 'async';
      const imageLink = document.createElement('a');
      imageLink.className = 'blog-card-image-link';
      imageLink.href = post.file;
      imageLink.append(image);
      media.append(imageLink);
      card.append(media);
    }
    const body = document.createElement('div');
    body.className = 'blog-card-body';

    const time = document.createElement('time');
    time.dateTime = post.date;
    time.textContent = safeDate(post.date);

    const heading = document.createElement('h2');
    const link = document.createElement('a');
    link.href = post.file;
    link.textContent = post.title;
    heading.append(link);

    const excerpt = document.createElement('p');
    excerpt.textContent = post.excerpt;

    const tags = document.createElement('div');
    tags.className = 'tag-list';
    (Array.isArray(post.tags) ? post.tags : []).forEach((tagText) => {
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

    body.append(time, heading, excerpt, tags, readLink);
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
      const postCategory = post.category || (Array.isArray(post.tags) ? post.tags[0] : '');
      const categoryMatches = !selectedCategory || categorySlug(postCategory) === selectedCategory;
      const searchable = [post.title, post.excerpt, post.category, ...(Array.isArray(post.tags) ? post.tags : [])]
        .filter(Boolean).join(' ').toLowerCase();
      return categoryMatches && searchable.includes(query);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const firstIndex = (currentPage - 1) * PAGE_SIZE;
    const visiblePosts = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);
    grid.replaceChildren(...visiblePosts.map(makeCard));
    renderPagination(totalPages);
    window.DomainCraftReveal?.(grid);

    if (filtered.length === 0) {
      const hasFilter = query || selectedCategory;
      setStatus(hasFilter ? 'No articles match those filters. Try another keyword or category.' : 'No articles are listed yet. Add a post to the manifest to publish one.', false);
    } else {
      const lastIndex = Math.min(firstIndex + PAGE_SIZE, filtered.length);
      setStatus(`Showing ${firstIndex + 1}–${lastIndex} of ${filtered.length} ${filtered.length === 1 ? 'article' : 'articles'}.`, false);
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
  setStatus('Loading articles…');

  fetch('./posts-manifest.json')
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the post manifest (${response.status}).`);
      return response.json();
    })
    .then((manifest) => {
      if (!Array.isArray(manifest)) throw new Error('The post manifest must be a JSON array.');
      posts = manifest.filter((post) => {
        const fileIsSafe = typeof post.file === 'string' && /^blog-[a-z0-9-]+\.html$/i.test(post.file);
        return fileIsSafe && typeof post.title === 'string' && typeof post.excerpt === 'string';
      });
      posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      render();
    })
    .catch((error) => {
      grid.replaceChildren();
      setStatus('The article list could not be loaded. Please refresh, or use the article links in the site navigation.', true);
      console.error('DomainCraft blog:', error);
    });
})();
