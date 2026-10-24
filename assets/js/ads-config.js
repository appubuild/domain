/*
 * DomainFits centralized AdSense slots.
 * Keep publisherId and slot markup empty until the site has an approved publisher ID,
 * real responsive ad units, and the required privacy/consent setup.
 * Paste only each responsive <ins class="adsbygoogle"> element into its code field.
 * ad-manager.js loads the AdSense library once and queues each slot once on the web.
 * The Capacitor build replaces this file with an empty, disabled native-app config.
 */
window.DOMAINFITS_AD_CONFIG = Object.freeze({
  enabled: true,
  publisherId: '',
  slots: Object.freeze({
    'header-banner': Object.freeze({ code: '' }),
    'generator-inline': Object.freeze({ code: '' }),
    'article-inline': Object.freeze({ code: '' })
  })
});
