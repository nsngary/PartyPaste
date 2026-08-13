import { expect, test } from "playwright/test";
import { bridgeCalls, installFakeBridge } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFakeBridge(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: /設定|Settings/, exact: true })
    .click();
});

test("confirms export and validates before complete backup replacement", async ({
  page,
}) => {
  await page.getByRole("button", { name: /匯出備份|Export backup/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /確認匯出|Confirm export/ })
    .click();
  await expect(page.getByText(/備份已匯出|Backup exported/)).toBeVisible();

  await page.getByRole("button", { name: /匯入備份|Import backup/ }).click();
  await expect(
    page.getByRole("heading", { name: /匯入預覽|Import preview/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /取代資料庫|Replace library/ })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /確認取代|Confirm replacement/ })
    .click();
  await expect(page.getByText(/備份已還原|Backup restored/)).toBeVisible();

  const commands = (await bridgeCalls(page)).map(({ command }) => command);
  expect(commands.indexOf("preview_import")).toBeLessThan(
    commands.indexOf("replace_from_backup"),
  );
  expect(commands).toContain("export_backup");
});

test("saves a user-configurable non-conflicting shortcut", async ({ page }) => {
  const input = page.locator(".pp-shortcut-input");
  await input.fill("Ctrl+Alt+P");
  await page.getByRole("button", { name: /儲存快捷鍵|Save shortcut/ }).click();
  await expect(page.getByText(/快捷鍵已儲存|Shortcut saved/)).toBeVisible();
  expect(
    (await bridgeCalls(page)).some(
      ({ command, input }) =>
        command === "set_overlay_shortcut" && input.shortcut === "Ctrl+Alt+P",
    ),
  ).toBeTruthy();
});
