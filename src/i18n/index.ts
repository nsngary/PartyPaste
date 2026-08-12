import { createInstance, type i18n } from "i18next";
import { createElement, type PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

export const supportedLocales = ["zh-TW", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export function resolveLocale(locale?: string): SupportedLocale {
  const normalized = locale?.toLowerCase();
  if (
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo" ||
    normalized?.startsWith("zh-hant")
  )
    return "zh-TW";
  return "en";
}

const resources = {
  en: { translation: en },
  "zh-TW": { translation: zhTW },
} as const;

export function createPartyPasteI18n(locale?: string): i18n {
  const instance = createInstance();
  void instance.init({
    resources,
    lng: resolveLocale(locale),
    fallbackLng: "en",
    supportedLngs: [...supportedLocales],
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  return instance;
}

const defaultI18n = createPartyPasteI18n(
  typeof navigator === "undefined" ? undefined : navigator.language,
);

export interface AppProvidersProps extends PropsWithChildren {
  i18n?: i18n;
}

export function AppProviders({
  children,
  i18n: instance = defaultI18n,
}: AppProvidersProps) {
  return createElement(I18nextProvider, { i18n: instance }, children);
}
