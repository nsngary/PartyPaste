import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "playwright/test";
import { installFakeBridge } from "./fixtures";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

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
  test(`captures ${sample.name}`, async ({ browser }, testInfo) => {
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
    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`${sample.name}.png`),
    });
    await context.close();
  });
}
