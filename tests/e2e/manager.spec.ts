import { expect, test } from "playwright/test";
import { bridgeCalls, installFakeBridge } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installFakeBridge(page);
  await page.goto("/");
  await expect(page.getByText("楓之谷", { exact: true }).first()).toBeVisible();
});

test("creates and edits phrases through the production manager entry", async ({
  page,
}) => {
  await page.locator(".pp-phrase-toolbar__top .pp-button").click();
  await page.locator(".pp-inspector-form input").nth(0).fill("今晚打王");
  await page.locator(".pp-inspector-form textarea").fill("晚上九點集合");
  await page.locator(".pp-inspector-form button[type=submit]").click();
  await expect(page.getByText("今晚打王", { exact: true })).toBeVisible();

  await page
    .locator(".pp-phrase-card")
    .filter({ hasText: "謝謝交易" })
    .locator(".pp-phrase-card__main")
    .click();
  await page.locator(".pp-inspector-form textarea").fill("感謝交易，下次見！");
  await page.locator(".pp-inspector-form button[type=submit]").click();
  await expect(
    page.locator(".pp-phrase-card").filter({ hasText: "謝謝交易" }),
  ).toContainText("感謝交易");

  const calls = await bridgeCalls(page);
  expect(calls.some(({ command }) => command === "create_phrase")).toBeTruthy();
  expect(calls.some(({ command }) => command === "update_phrase")).toBeTruthy();
});

test("reorders phrases with the accessible move control", async ({ page }) => {
  await page
    .getByRole("button", { name: /將 謝謝交易 上移|Move 謝謝交易 up/ })
    .click();
  await expect
    .poll(
      async () =>
        (await bridgeCalls(page)).filter(
          ({ command }) => command === "reorder_phrases",
        ).length,
    )
    .toBe(1);
  const call = (await bridgeCalls(page)).find(
    ({ command }) => command === "reorder_phrases",
  );
  expect(call?.input.orderedIds).toEqual(["phrase-thanks", "phrase-buy"]);
});

test("defaults to Traditional Chinese and persists an English switch", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: /設定|Settings/, exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("partypaste.locale")))
    .toBe("en");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
});
