/* Shared interactions: accessible navigation, theme preference, contact form. */
(() => {
  const root = document.documentElement;
  const themeStorageKey = 'domaincraft-theme';

  function readSavedTheme() {
    try {
      const saved = window.localStorage.getItem(themeStorageKey);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (error) {
      // Storage may be blocked; the page remains usable without it.
    }
    // New visitors start in light mode; only an explicit saved choice overrides it.
    return 'light';
  }

  function setTheme(theme, persist = false) {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const icon = button.querySelector('[aria-hidden="true"]');
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      button.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
      button.title = `Switch to ${nextTheme} theme`;
      if (icon) icon.textContent = theme === 'dark' ? '☼' : '◐';
    });
    if (persist) {
      try {
        window.localStorage.setItem(themeStorageKey, theme);
      } catch (error) {
        // Do not block theme switching when storage is unavailable.
      }
    }
  }

  setTheme(readSavedTheme());

  document.addEventListener('click', (event) => {
    const themeButton = event.target.closest('[data-theme-toggle]');
    if (themeButton) {
      setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
      return;
    }

    const menuButton = event.target.closest('[data-menu-toggle]');
    if (menuButton) {
      const nav = document.getElementById(menuButton.getAttribute('aria-controls'));
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
      nav?.classList.toggle('is-open', !isOpen);
    }
  });

  document.querySelectorAll('[data-current-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  const contactForm = document.querySelector('[data-contact-form]');
  if (contactForm) {
    const status = contactForm.querySelector('[data-form-status]');
    const submitButton = contactForm.querySelector('[type="submit"]');

    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;

      const endpoint = (contactForm.dataset.formspreeEndpoint || contactForm.getAttribute('action') || '').trim();
      if (!endpoint || endpoint.includes('REPLACE_WITH')) {
        if (status) {
          status.textContent = 'The form is ready, but no delivery service is configured yet. Add your Formspree form URL in this page before publishing.';
          status.setAttribute('role', 'status');
        }
        return;
      }

      const originalLabel = submitButton?.textContent;
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending…';
      }
      if (status) status.textContent = '';

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: new FormData(contactForm),
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('The form service returned an error.');
        contactForm.reset();
        if (status) {
          status.textContent = 'Thanks — your message has been sent.';
          status.setAttribute('role', 'status');
        }
      } catch (error) {
        if (status) {
          status.textContent = 'We could not send your message. Please check the Formspree URL or try again later.';
          status.setAttribute('role', 'alert');
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalLabel || 'Send message';
        }
      }
    });
  }
})();
