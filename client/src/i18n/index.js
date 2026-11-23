import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import fil from "./locales/fil.json";
// Reports and dashboard analytics strings live in their own files (merged here) so they
// do not collide with edits to the big locale files.
import analyticsEn from "./locales/analytics.en.json";
import analyticsFil from "./locales/analytics.fil.json";
// Apply-document flow (Studio applying mode, resume type, photo, upload, hiring manager).
import applyFlowEn from "./locales/applyFlow.en.json";
import applyFlowFil from "./locales/applyFlow.fil.json";

const STORAGE_KEY = "stramPesoLanguage";

// Nested merge: the analytics files add keys and may replace single ones (the "Analytics & Reports" label).
const deepMerge = (base, extra) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" ? deepMerge(base[key], value) : value;
  }
  return out;
};

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
    en: { translation: deepMerge(deepMerge(en, analyticsEn), applyFlowEn) },
    fil: { translation: deepMerge(deepMerge(fil, analyticsFil), applyFlowFil) },
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
