/* Keep unpublished static article pages out of the visible site until config says true. */
(() => {
  'use strict';

  const article = document.querySelector('[data-publish-guard]');
  const notice = document.querySelector('[data-draft-notice]');
  const cta = document.querySelector('[data-publish-guard-cta]');
  if (!article || !notice) return;

  const slug = article.dataset.postSlug || '';
  const file = window.location.pathname.split('/').pop() || '';
  const robots = document.querySelector('meta[name="robots"]');
  const showDraftNotice = (message) => {
    article.hidden = true;
    notice.hidden = false;
    notice.textContent = message;
  };
  const announcePublicationState = (published) => {
    if (typeof CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('domainfits:publicationchange', { detail: { published } }));
    }
  };

  fetch('/blog/blog-config.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Could not verify publication state (${response.status}).`);
      return response.json();
    })
    .then((config) => {
      const post = config && Array.isArray(config.posts)
        ? config.posts.find((entry) => entry && entry.slug === slug && entry.file === file)
        : null;
      if (post && post.published === true) {
        article.hidden = false;
        if (cta) cta.hidden = false;
        notice.hidden = true;
        if (robots) robots.content = 'index,follow,max-image-preview:large';
        announcePublicationState(true);
        return;
      }
      showDraftNotice('This article is not currently published. Return to the blog archive for available articles.');
      announcePublicationState(false);
    })
    .catch((error) => {
      showDraftNotice('Publication status could not be verified, so this article remains hidden. Please return to the blog archive.');
      announcePublicationState(false);
      console.error('DomainFits publication guard:', error);
    });
})();
