import { expect, test } from "playwright/test";
import { bridgeCalls, installFakeBridge } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFakeBridge(page);
  await page.goto("/overlay.html");
  await expect(page.getByRole("button", { name: "收購卷軸" })).toBeVisible();
});

test("copies plain text and resolves a template from editable common values", async ({
  page,
}) => {
  await page.getByRole("button", { name: "謝謝交易" }).click();
  await expect(page.getByText(/已複製|Copied/)).toBeVisible();

  await page.getByRole("button", { name: "收購卷軸" }).click();
  await page.getByRole("button", { name: "混沌卷軸" }).click();
  await page.getByRole("button", { name: "5000萬" }).click();
  await expect(
    page.getByText("收購 混沌卷軸，預算 5000萬", { exact: true }),
  ).toBeVisible();
  await page.locator(".pp-template-form button[type=submit]").click();

  const copies = (await bridgeCalls(page)).filter(
    ({ command }) => command === "copy_phrase",
  );
  expect(copies).toHaveLength(2);
  expect(copies[1]?.input.variables).toEqual({
    物品: "混沌卷軸",
    價格: "5000萬",
  });
});

test("switches between compact title and full-sentence display", async ({
  page,
}) => {
  await expect(
    page.getByText("謝謝，祝遊戲愉快！", { exact: true }),
  ).toHaveCount(0);
  await page.locator('.pp-segmented__option[data-value="full"]').click();
  await expect(
    page.getByText("謝謝，祝遊戲愉快！", { exact: true }),
  ).toBeVisible();
  expect(
    (await bridgeCalls(page)).some(
      ({ command }) => command === "set_overlay_display_mode",
    ),
  ).toBeTruthy();
});

test("toggles always-on-top through the native command boundary", async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem("partypaste.locale", "en"));
  await page.reload();
  await expect(page.getByRole("button", { name: "收購卷軸" })).toBeVisible();
  const topmostButton = page.locator(".pp-overlay__header .pp-icon-button");
  await expect(topmostButton).toHaveAttribute("aria-pressed", "true");
  await expect(topmostButton).toHaveAccessibleName("Unpin overlay");
  await topmostButton.click();
  await expect
    .poll(
      async () =>
        (await bridgeCalls(page)).filter(
          ({ command }) => command === "toggle_topmost",
        ).length,
    )
    .toBe(1);
  const call = (await bridgeCalls(page)).find(
    ({ command }) => command === "toggle_topmost",
  );
  expect(call?.input).toEqual({ alwaysOnTop: false });
  await expect(topmostButton).toHaveAttribute("aria-pressed", "false");
  await expect(topmostButton).toHaveAccessibleName("Pin overlay");
});
