import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.appubuild.landexpert',
  appName: 'Land Expert',
  webDir: 'apps/web/dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
