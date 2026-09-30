/**
 * i18n configuration for AirQR Web App
 * Supports English (default) and French
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en';
import fr from './locales/fr';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    lng: localStorage.getItem('airqr_language') || 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'airqr_language',
      caches: ['localStorage'],
    },
  });

export default i18n;
