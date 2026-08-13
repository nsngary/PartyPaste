import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "playwright/test";
import { installFakeBridge } from "./fixtures";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

async function expectWithinViewport(
  locator: ReturnType<import("playwright/test").Page["locator"]>,
  viewport: { width: number; height: number },
) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    viewport.height,
  );
}

for (const entry of ["/", "/overlay.html"] as const) {
  test(`${entry} has no serious axe violations`, async ({ page }) => {
    await installFakeBridge(page);
    await page.goto(entry);
    await page.locator("main").waitFor();
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const result = await (
        window as unknown as {
          axe: {
            run(): Promise<{
              violations: Array<{ impact: string | null; id: string }>;
            }>;
          };
        }
      ).axe.run();
      return result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      );
    });
    expect(violations).toEqual([]);
  });
}

for (const sample of [
  {
    name: "manager-760-100",
    path: "/",
    width: 760,
    height: 560,
    scale: 1,
    locale: "zh-TW",
  },
  {
    name: "manager-1120-150-en",
    path: "/",
    width: 1120,
    height: 720,
    scale: 1.5,
    locale: "en",
  },
  {
    name: "overlay-240-200",
    path: "/overlay.html",
    width: 240,
    height: 420,
    scale: 2,
    locale: "zh-TW",
  },
  {
    name: "overlay-300-150-en",
    path: "/overlay.html",
    width: 300,
    height: 420,
    scale: 1.5,
    locale: "en",
  },
  {
    name: "overlay-420-100",
    path: "/overlay.html",
    width: 420,
    height: 520,
    scale: 1,
    locale: "zh-TW",
  },
] as const) {
  test(`keeps critical UI usable at ${sample.name}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      deviceScaleFactor: sample.scale,
      locale: sample.locale,
      viewport: { width: sample.width, height: sample.height },
    });
    const page = await context.newPage();
    await installFakeBridge(page);
    await page.addInitScript(
      (locale) => localStorage.setItem("partypaste.locale", locale),
      sample.locale,
    );
    await page.goto(`http://127.0.0.1:4173${sample.path}`);
    await page.locator("main").waitFor();
    const viewport = { width: sample.width, height: sample.height };
    const layout = await page.evaluate(() => ({
      bodyClientWidth: document.body.clientWidth,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      bodyScrollHeight: document.body.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      pixelRatio: window.devicePixelRatio,
    }));
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(
      layout.documentClientWidth,
    );
    expect(layout.bodyClientWidth).toBeLessThanOrEqual(viewport.width);
    expect(layout.pixelRatio).toBe(sample.scale);

    if (sample.path === "/") {
      await expectWithinViewport(page.locator(".pp-game-sidebar"), viewport);
      await expectWithinViewport(
        page.locator(".pp-game-sidebar nav button").first(),
        viewport,
      );
      await expectWithinViewport(
        page.locator(".pp-phrase-toolbar__top .pp-button"),
        viewport,
      );
      await expectWithinViewport(page.locator(".pp-search"), viewport);
      await expectWithinViewport(
        page.locator(".pp-content-actions .pp-button"),
        viewport,
      );
      await expectWithinViewport(
        page.locator(".pp-phrase-card").first(),
        viewport,
      );
      await expect(page.locator(".pp-manager")).toHaveCSS("overflow", "hidden");
      await expect(page.locator(".pp-manager__content")).toHaveCSS(
        "overflow",
        "auto",
      );
      if (sample.width >= 1000) {
        await expectWithinViewport(
          page.locator(".pp-manager__inspector"),
          viewport,
        );
      }
    } else {
      await expectWithinViewport(
        page.locator(".pp-overlay__game-select select"),
        viewport,
      );
      await expectWithinViewport(
        page.locator(".pp-overlay__header .pp-icon-button"),
        viewport,
      );
      await expectWithinViewport(
        page.locator(".pp-segmented").first(),
        viewport,
      );
      await expectWithinViewport(
        page.locator(".pp-phrase-row").first(),
        viewport,
      );
      expect(layout.documentScrollHeight).toBeGreaterThanOrEqual(
        layout.documentClientHeight,
      );
      expect(layout.bodyScrollHeight).toBeGreaterThanOrEqual(viewport.height);
      expect(["auto", "visible"]).toContain(layout.bodyOverflowY);
    }
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`${sample.name}.png`),
    });
    await context.close();
  });
}
