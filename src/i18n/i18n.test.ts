import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { AppProviders, createPartyPasteI18n, resolveLocale } from ".";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];

  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function LanguageProbe() {
  const { i18n, t } = useTranslation();
  return createElement(
    Fragment,
    null,
    createElement("p", null, t("common.cancel")),
    createElement(
      "button",
      { type: "button", onClick: () => void i18n.changeLanguage("en") },
      t("settings.language.english"),
    ),
  );
}

describe("PartyPaste localization", () => {
  it("keeps the Traditional Chinese and English catalogs in exact key parity", () => {
    expect(flattenKeys(zhTW).sort()).toEqual(flattenKeys(en).sort());
  });

  it("falls back to English for an unsupported Windows locale", async () => {
    const i18n = createPartyPasteI18n("fr-FR");
    await i18n.init();

    expect(i18n.t("common.cancel")).toBe("Cancel");
  });

  it("recognizes Windows Traditional Chinese locale variants", () => {
    expect(resolveLocale("zh-HK")).toBe("zh-TW");
    expect(resolveLocale("zh-Hant-HK")).toBe("zh-TW");
    expect(resolveLocale("zh-CN")).toBe("en");
  });

  it("switches language without replacing phrase content", async () => {
    const user = userEvent.setup();
    const i18n = createPartyPasteI18n("zh-TW");
    await i18n.init();

    render(
      createElement(
        AppProviders,
        { i18n },
        createElement(LanguageProbe),
        createElement("p", null, "團隊今晚八點集合"),
      ),
    );

    expect(screen.getByText("取消")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByText("Cancel")).toBeTruthy();
    expect(screen.getByText("團隊今晚八點集合")).toBeTruthy();
  });
});
