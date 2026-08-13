import { createInstance, type i18n } from "i18next";
import { createElement, type PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

export const supportedLocales = ["zh-TW", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const localeStorageKey = "partypaste.locale";

export function resolveLocale(locale?: string): SupportedLocale {
  const normalized = locale?.toLowerCase();
  if (
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo" ||
    normalized?.startsWith("zh-hant")
  )
    return "zh-TW";
  if (normalized === "en" || normalized?.startsWith("en-")) return "en";
  return "zh-TW";
}

function persistedLocale(): SupportedLocale | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const value = localStorage.getItem(localeStorageKey);
    return supportedLocales.find((locale) => locale === value);
  } catch {
    return undefined;
  }
}

const resources = {
  en: { translation: en },
  "zh-TW": { translation: zhTW },
} as const;

export function createPartyPasteI18n(locale?: string): i18n {
  const instance = createInstance();
  void instance.init({
    resources,
    lng:
      locale === undefined
        ? (persistedLocale() ?? "zh-TW")
        : resolveLocale(locale),
    fallbackLng: "zh-TW",
    supportedLngs: [...supportedLocales],
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  return instance;
}

export async function setPartyPasteLocale(
  instance: i18n,
  locale: SupportedLocale,
): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(localeStorageKey, locale);
    } catch {
      // A storage failure must not prevent the current window from switching.
    }
  }
  await instance.changeLanguage(locale);
}

const defaultI18n = createPartyPasteI18n();

export interface AppProvidersProps extends PropsWithChildren {
  i18n?: i18n;
}

export function AppProviders({
  children,
  i18n: instance = defaultI18n,
}: AppProvidersProps) {
  return createElement(I18nextProvider, { i18n: instance }, children);
}
