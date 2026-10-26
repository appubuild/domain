/* Render configured responsive ad slots on the web, never in a Capacitor native app. */
(() => {
  'use strict';

  const SLOT_SELECTOR = '[data-ad-slot]';
  const AD_SCRIPT_SELECTOR = 'script[data-domainfits-ads-loader]';

  function isNativeApp() {
    if (window.DomainFitsPlatform?.isNative?.()) return true;
    const capacitor = window.Capacitor;
    if (capacitor && typeof capacitor.isNativePlatform === 'function') {
      try {
        if (capacitor.isNativePlatform()) return true;
      } catch (error) {
        // The protocol fallback below is sufficient when a bridge call fails.
      }
    }
    return ['capacitor:', 'ionic:'].includes(String(window.location?.protocol || '').toLowerCase());
  }

  function findSlots() {
    return Array.from(document.querySelectorAll(SLOT_SELECTOR));
  }

  function clearSlot(slot) {
    slot.replaceChildren();
    slot.hidden = true;
    slot.removeAttribute('data-ad-rendered');
    slot.classList.remove('is-ad-ready');
  }

  function hideAllSlots() {
    findSlots().forEach(clearSlot);
  }

  function isPublicationPending() {
    const gatedArticle = document.querySelector('[data-publish-guard]');
    return Boolean(gatedArticle && gatedArticle.hidden);
  }

  function createSafeFragment(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    const fragment = template.content;
    fragment.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
    fragment.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attribute) => {
        if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      });
    });
    return fragment;
  }

  function loadAdSenseOnce(publisherId) {
    if (document.querySelector(AD_SCRIPT_SELECTOR)) return;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`;
    script.dataset.domainfitsAdsLoader = 'true';
    script.addEventListener('error', () => {
      console.warn('DomainFits: the AdSense library could not be loaded.');
    }, { once: true });
    document.head.appendChild(script);
  }

  function renderConfiguredSlots() {
    if (isNativeApp()) {
      hideAllSlots();
      return;
    }

    const config = window.DOMAINFITS_AD_CONFIG;
    const publisherId = String(config?.publisherId || '').trim();
    const ready = config?.enabled === true && /^ca-pub-\d+$/.test(publisherId);
    if (!ready) {
      hideAllSlots();
      return;
    }

    const rendered = [];
    findSlots().forEach((slot) => {
      const name = String(slot.dataset.adSlot || '');
      const markup = String(config.slots?.[name]?.code || '').trim();
      if (!markup) {
        clearSlot(slot);
        return;
      }

      const fragment = createSafeFragment(markup);
      if (!fragment.querySelector('ins.adsbygoogle')) {
        clearSlot(slot);
        return;
      }

      slot.replaceChildren(fragment.cloneNode(true));
      slot.hidden = false;
      slot.setAttribute('data-ad-rendered', 'true');
      slot.classList.add('is-ad-ready');
      rendered.push(slot);
    });

    if (!rendered.length) return;
    loadAdSenseOnce(publisherId);
    window.adsbygoogle = window.adsbygoogle || [];
    rendered.forEach(() => {
      try {
        window.adsbygoogle.push({});
      } catch (error) {
        console.warn('DomainFits: an ad slot could not be initialized.', error);
      }
    });
  }

  if (isNativeApp()) {
    hideAllSlots();
    return;
  }

  if (isPublicationPending()) {
    window.addEventListener('domainfits:publicationchange', (event) => {
      if (event.detail?.published === true) renderConfiguredSlots();
      else hideAllSlots();
    });
    return;
  }

  renderConfiguredSlots();
})();
