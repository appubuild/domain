/* Platform detection shared by ads, PWA, and other platform-aware features. */
(() => {
  'use strict';

  const NATIVE_PLATFORMS = new Set(['android', 'ios']);

  function getNativePlatform() {
    const capacitor = window.Capacitor;
    if (capacitor) {
      try {
        if (typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform()) {
          const platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : 'native';
          return NATIVE_PLATFORMS.has(String(platform).toLowerCase()) ? String(platform).toLowerCase() : 'native';
        }
        if (typeof capacitor.getPlatform === 'function') {
          const platform = String(capacitor.getPlatform()).toLowerCase();
          if (NATIVE_PLATFORMS.has(platform)) return platform;
        }
      } catch (error) {
        // Fall through to the Capacitor WebView protocol check.
      }
    }

    const protocol = String(window.location?.protocol || '').toLowerCase();
    return protocol === 'capacitor:' || protocol === 'ionic:' ? 'native' : '';
  }

  function isMobileWeb() {
    const userAgentDataMobile = navigator.userAgentData?.mobile;
    if (typeof userAgentDataMobile === 'boolean') return userAgentDataMobile;

    const userAgent = String(navigator.userAgent || '');
    if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent)) return true;

    const narrowViewport = typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 767px)').matches;
    const touchPoints = Number(navigator.maxTouchPoints || 0);
    return Boolean(narrowViewport && touchPoints > 0);
  }

  function detectPlatform() {
    const nativePlatform = getNativePlatform();
    if (nativePlatform) {
      return {
        kind: 'capacitor-native',
        platform: nativePlatform,
        isNative: true,
        isWeb: false,
        isMobile: false
      };
    }

    const mobile = isMobileWeb();
    return {
      kind: mobile ? 'mobile-web' : 'desktop-web',
      platform: 'web',
      isNative: false,
      isWeb: true,
      isMobile: mobile
    };
  }

  let lastKind = detectPlatform().kind;

  function announcePlatformChange() {
    const current = detectPlatform();
    if (current.kind === lastKind) return;
    lastKind = current.kind;
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('domainfits:platformchange', { detail: current }));
    }
  }

  window.DomainFitsPlatform = Object.freeze({
    detect: detectPlatform,
    isNative: () => detectPlatform().isNative,
    getKind: () => detectPlatform().kind
  });

  window.addEventListener('resize', announcePlatformChange, { passive: true });
  window.addEventListener('orientationchange', announcePlatformChange, { passive: true });
})();
