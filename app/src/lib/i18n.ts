import { register, init, locale, getLocaleFromNavigator } from 'svelte-i18n';

register('fr', () => import('./locales/fr.json'));
register('en', () => import('./locales/en.json'));

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export function initI18n(savedLocale?: string) {
  let initialLocale: string;

  if (savedLocale && SUPPORTED_LOCALES.includes(savedLocale as SupportedLocale)) {
    // Utiliser la langue sauvegardée
    initialLocale = savedLocale;
  } else {
    // Détecter la langue du navigateur
    const browserLocale = getLocaleFromNavigator();
    const lang = browserLocale?.split('-')[0] || 'en';
    initialLocale = SUPPORTED_LOCALES.includes(lang as SupportedLocale) ? lang : 'en';
  }

  init({
    fallbackLocale: 'en',
    initialLocale
  });
}

export function setLocale(lang: SupportedLocale) {
  locale.set(lang);
}
