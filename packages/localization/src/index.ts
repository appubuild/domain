import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/common.json';
import bn from './locales/bn/common.json';

export const resources = { en: { common: en }, bn: { common: bn } } as const;
export const supportedLanguages = ['en', 'bn'] as const;
export type Language = (typeof supportedLanguages)[number];
const storageKey = 'land-expert.language';

export function readLanguage(): Language {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'bn' ? 'bn' : 'en';
  } catch { return 'en'; }
}

export async function setLanguage(language: Language): Promise<boolean> {
  await i18next.changeLanguage(language);
  try { localStorage.setItem(storageKey, language); return true; } catch { return false; }
}

void i18next.use(initReactI18next).init({ resources, lng: readLanguage(), fallbackLng: 'en', defaultNS: 'common', interpolation: { escapeValue: false }, returnNull: false });
i18next.on('languageChanged', language => { document.documentElement.lang = language; });
document.documentElement.lang = i18next.language || 'en';
export default i18next;
