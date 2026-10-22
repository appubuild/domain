/* Client-side static blog archive powered by blog/posts-manifest.json. */
(() => {
  const grid = document.querySelector('[data-blog-grid]');
  if (!grid) return;

  const status = document.querySelector('[data-blog-status]');
  const search = document.querySelector('[data-blog-search]');
  const categoryFilter = document.querySelector('[data-blog-category]');
  const requestedCategory = new URLSearchParams(window.location?.search || '').get('category');
  if (categoryFilter && requestedCategory && Array.from(categoryFilter.options || []).some((option) => option.value === requestedCategory)) {
    categoryFilter.value = requestedCategory;
  }
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

    grid.replaceChildren(...filtered.map(makeCard));
    window.DomainCraftReveal?.(grid);
    if (filtered.length === 0) {
      const hasFilter = query || selectedCategory;
      setStatus(hasFilter ? 'No articles match those filters. Try another keyword or category.' : 'No articles are listed yet. Add a post to the manifest to publish one.', false);
    } else {
      const hasFilter = query || selectedCategory;
      setStatus(`${filtered.length} ${filtered.length === 1 ? 'article' : 'articles'}${hasFilter ? ' found' : ' available'}.`, false);
    }
  };

  search?.addEventListener('input', render);
  categoryFilter?.addEventListener('change', render);
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
