/* Register the installable-site service worker only in a secure browser context. */
(() => {
  'use strict';

  const platform = window.DomainFitsPlatform?.detect?.();
  const native = platform?.isNative === true
    || ['capacitor:', 'ionic:'].includes(String(window.location?.protocol || '').toLowerCase());
  if (native || !('serviceWorker' in navigator)) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .catch((error) => console.warn('DomainFits could not register its offline service worker:', error));
  }, { once: true });
})();
