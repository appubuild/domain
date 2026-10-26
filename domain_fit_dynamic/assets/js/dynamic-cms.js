/* Local CMS interactions. No CDN/runtime library dependency. */
(() => {
  'use strict';
  const config = window.DOMAINFIT_CONFIG || { basePath: '', analyticsEnabled: false };
  const basePath = String(config.basePath || '').replace(/\/$/, '');
  const url = (path) => `${basePath}/${String(path || '').replace(/^\//, '')}`;

  if (config.analyticsEnabled) {
    const sendEvent = (event) => {
      const payload = JSON.stringify({ event, path: window.location.pathname });
      fetch(url('api/track.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        credentials: 'same-origin',
        keepalive: true
      }).catch(() => {});
    };
    sendEvent('page_view');
    document.getElementById('generateBtn')?.addEventListener('click', () => sendEvent('generator_run'));
  }

  document.querySelectorAll('[data-cms-contact-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const status = form.querySelector('[data-form-status]');
      const submit = form.querySelector('[type="submit"]');
      const originalText = submit?.textContent || 'Send message';
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Sending…';
      }
      if (status) {
        status.textContent = '';
        status.removeAttribute('role');
      }
      try {
        const response = await fetch(form.dataset.endpoint || form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'same-origin'
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'We could not send your message.');
        form.reset();
        if (status) {
          status.textContent = result.message || 'Thanks — your message has been received.';
          status.setAttribute('role', 'status');
        }
      } catch (error) {
        if (status) {
          status.textContent = error instanceof Error ? error.message : 'We could not send your message. Please try again.';
          status.setAttribute('role', 'alert');
        }
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = originalText;
        }
      }
    });
  });
})();
