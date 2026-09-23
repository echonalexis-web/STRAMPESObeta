import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import fil from "./locales/fil.json";

const STORAGE_KEY = "stramPesoLanguage";

// localStorage can throw on access (Safari private browsing, storage
// disabled by policy, a restricted iframe) — this runs at module load time,
// before React mounts, so an unguarded throw here would white-screen the
// whole app rather than just fail to remember the language.
const readStoredLanguage = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};
const storedLanguage = readStoredLanguage();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fil: { translation: fil },
  },
  lng: storedLanguage || "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // storage unavailable — language still switches in-memory for this session
  }
});

export default i18n;
