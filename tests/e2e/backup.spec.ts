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
  const replaceCall = (await bridgeCalls(page)).find(
    ({ command }) => command === "replace_from_backup",
  );
  expect(replaceCall?.input).toEqual({
    path: "C:\\Temp\\library-v1.json",
    previewToken: "preview-e2e",
  });
});

test("fake native boundary rejects a missing or mismatched preview token", async ({
  page,
}) => {
  const outcomes = await page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(
            command: string,
            input: Record<string, unknown>,
          ): Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke;
    const preview = (await invoke("preview_import", {
      path: "C:\\Temp\\library-v1.json",
    })) as { previewToken: string };
    const attempt = async (input: Record<string, unknown>) => {
      try {
        await invoke("replace_from_backup", input);
        return "accepted";
      } catch {
        return "rejected";
      }
    };
    return {
      missing: await attempt({ path: "C:\\Temp\\library-v1.json" }),
      wrongPath: await attempt({
        path: "C:\\Temp\\other.json",
        previewToken: preview.previewToken,
      }),
      wrongToken: await attempt({
        path: "C:\\Temp\\library-v1.json",
        previewToken: "wrong-token",
      }),
    };
  });
  expect(outcomes).toEqual({
    missing: "rejected",
    wrongPath: "rejected",
    wrongToken: "rejected",
  });
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
