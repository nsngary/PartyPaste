import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppProviders,
  createPartyPasteI18n,
  localeStorageKey,
  resolveLocale,
  setPartyPasteLocale,
} from ".";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];

  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function flattenValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(flattenValues);
}

function LanguageProbe() {
  const { i18n, t } = useTranslation();
  return createElement(
    Fragment,
    null,
    createElement("p", null, t("common.cancel")),
    createElement("p", null, t("manager.newGame")),
    createElement(
      "button",
      { type: "button", onClick: () => void i18n.changeLanguage("en") },
      t("settings.language.english"),
    ),
  );
}

describe("PartyPaste localization", () => {
  let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
  });

  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(
        globalThis,
        "localStorage",
        originalLocalStorageDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
    globalThis.localStorage?.clear();
  });
  it("keeps the Traditional Chinese and English catalogs in exact key parity", () => {
    expect(flattenKeys(zhTW).sort()).toEqual(flattenKeys(en).sort());
  });

  it("keeps Task 11 production copy behind catalog lookups", () => {
    const files = [
      "DeleteConfirm.tsx",
      "GameSidebar.tsx",
      "GroupSection.tsx",
      "ManagerApp.tsx",
      "PhraseCard.tsx",
      "PhraseInspector.tsx",
      "PhraseToolbar.tsx",
      "UndoToast.tsx",
      "../variables/PresetEditor.tsx",
      "../variables/VariableDefinitionCard.tsx",
      "../variables/VariableLibrary.tsx",
    ];
    const source = files
      .map((file) =>
        readFileSync(
          resolve(import.meta.dirname, `../features/library/${file}`),
          "utf8",
        ),
      )
      .join("\n");
    const directEnglishCopy = flattenValues(en.manager).filter(
      (value) => !value.includes("{{"),
    );

    for (const copy of directEnglishCopy) {
      expect(source, `Hard-coded Task 11 copy: ${copy}`).not.toContain(
        JSON.stringify(copy),
      );
      expect(source, `Hard-coded Task 11 JSX copy: ${copy}`).not.toContain(
        `>${copy}<`,
      );
    }
    expect(source).not.toContain("This removes ${");

    const managerEntry = readFileSync(
      resolve(import.meta.dirname, "../app/manager-main.tsx"),
      "utf8",
    );
    expect(managerEntry).toContain(
      'throw new Error("PARTYPASTE_MANAGER_ROOT_MISSING")',
    );
    expect(managerEntry).not.toContain("Manager root element is missing.");
  });

  it("falls back to Traditional Chinese for an unsupported locale", async () => {
    const i18n = createPartyPasteI18n("fr-FR");
    await i18n.init();

    expect(i18n.language).toBe("zh-TW");
  });

  it("recognizes Windows Traditional Chinese locale variants", () => {
    expect(resolveLocale("zh-HK")).toBe("zh-TW");
    expect(resolveLocale("zh-Hant-HK")).toBe("zh-TW");
    expect(resolveLocale("zh-CN")).toBe("zh-TW");
  });

  it("defaults to Traditional Chinese even when the browser locale is English", () => {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "en-US",
    });
    expect(createPartyPasteI18n().language).toBe("zh-TW");
  });

  it("persists an immediate runtime switch and restores it in a new instance", async () => {
    const first = createPartyPasteI18n();
    await setPartyPasteLocale(first, "en");
    expect(first.t("manager.phrases")).toBe("Phrases");
    expect(localStorage.getItem(localeStorageKey)).toBe("en");

    const nextWindow = createPartyPasteI18n();
    expect(nextWindow.language).toBe("en");
    expect(nextWindow.t("manager.phrases")).toBe("Phrases");
  });

  it("ignores an invalid persisted locale and falls back to Traditional Chinese", () => {
    localStorage.setItem(localeStorageKey, "ja");
    expect(createPartyPasteI18n().language).toBe("zh-TW");
  });

  it("defaults to Traditional Chinese when acquiring localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });

    expect(() => createPartyPasteI18n()).not.toThrow();
    expect(createPartyPasteI18n().language).toBe("zh-TW");
  });

  it("still switches runtime language when acquiring localStorage throws", async () => {
    const instance = createPartyPasteI18n("zh-TW");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });

    await expect(setPartyPasteLocale(instance, "en")).resolves.toBeUndefined();
    expect(instance.language).toBe("en");
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
    expect(screen.getByText("新增遊戲")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByText("Cancel")).toBeTruthy();
    expect(screen.getByText("New game")).toBeTruthy();
    expect(screen.getByText("團隊今晚八點集合")).toBeTruthy();
  });
});
