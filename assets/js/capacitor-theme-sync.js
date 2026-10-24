import { Capacitor } from '@capacitor/core';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { NavigationBar, Style as NavigationBarStyle } from '@capawesome/capacitor-navigation-bar';

const PALETTES = {
  light: {
    background: '#f7f8fc',
    divider: '#e3e7f0',
    statusBarStyle: StatusBarStyle.Light,
    navigationBarStyle: NavigationBarStyle.Light
  },
  dark: {
    background: '#10121b',
    divider: '#2b3042',
    statusBarStyle: StatusBarStyle.Dark,
    navigationBarStyle: NavigationBarStyle.Dark
  }
};

let updateSequence = 0;
let pendingUpdate = Promise.resolve();

function isAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function syncSystemBars(theme) {
  if (!isAndroidApp()) return Promise.resolve();

  const palette = PALETTES[theme === 'dark' ? 'dark' : 'light'];
  const sequence = ++updateSequence;
  pendingUpdate = pendingUpdate
    .catch(() => undefined)
    .then(async () => {
      // Keep rapid theme toggles ordered; the most recent event wins.
      if (sequence !== updateSequence) return;
      const results = await Promise.allSettled([
        StatusBar.setBackgroundColor({ color: palette.background }),
        StatusBar.setStyle({ style: palette.statusBarStyle }),
        NavigationBar.setColor({ color: palette.background }),
        NavigationBar.setStyle({ style: palette.navigationBarStyle })
      ]);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) {
        console.warn('DomainFits could not fully synchronize Android system bars:', failures);
      }
    });
  return pendingUpdate;
}

window.addEventListener('domainfits:themechange', (event) => {
  syncSystemBars(event.detail?.theme || currentTheme());
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncSystemBars(currentTheme());
});

// main.js may have emitted its initial theme event before this deferred bundle loaded.
syncSystemBars(currentTheme());
