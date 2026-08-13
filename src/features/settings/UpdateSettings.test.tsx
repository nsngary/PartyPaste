import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { UpdateSettings } from "./UpdateSettings";

afterEach(cleanup);

describe("UpdateSettings", () => {
  it("explains the deferred self-use update boundary in English", () => {
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <UpdateSettings />
      </AppProviders>,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Check for updates",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Signed online updates are deferred. This self-use build does not check, download, or install updates.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Installed: run a newer installer manually. Portable: export a backup, then replace the whole portable folder.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("explains the deferred self-use update boundary in Traditional Chinese", () => {
    render(
      <AppProviders i18n={createPartyPasteI18n("zh-TW")}>
        <UpdateSettings />
      </AppProviders>,
    );

    expect(
      screen.getByText(
        "已簽署的線上更新功能暫緩實作；此自用版本不會檢查、下載或安裝更新。",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "安裝版：請手動執行新版安裝程式。免安裝版：請先匯出備份，再更換整個免安裝資料夾。",
      ),
    ).toBeTruthy();
  });
});
