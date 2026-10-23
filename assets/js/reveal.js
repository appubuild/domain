/* Lightweight scroll reveal: IntersectionObserver, no animation library or layout polling. */
(() => {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const selector = '.feature-card, .step-card, .content-band, .faq-list details, .blog-card, .contact-card, .contact-aside, .generator-panel, .article-note, .cta-band';

  if (reducedMotion || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -36px 0px' });

  function observeReveals(scope = document) {
    scope.querySelectorAll(`${selector}:not([data-reveal-ready])`).forEach((element) => {
      element.setAttribute('data-reveal-ready', 'true');
      observer.observe(element);
    });
  }

  window.DomainCraftReveal = observeReveals;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => observeReveals(), { once: true });
  } else {
    observeReveals();
  }
})();
