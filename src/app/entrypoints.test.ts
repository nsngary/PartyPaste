import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { routeForWindowLabel } from "./window-route";

async function findFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? findFiles(path) : [path];
      }),
    )
  ).flat();
}

describe("routeForWindowLabel", () => {
  it.each<["manager" | "overlay", "/" | "/overlay.html"]>([
    ["manager", "/"],
    ["overlay", "/overlay.html"],
  ])("maps %s", (label, route) => {
    expect(routeForWindowLabel(label)).toBe(route);
  });

  it("bundles the shared controls and required fonts for both windows", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "partypaste-assets-"));

    try {
      await build({
        configFile: resolve("vite.config.ts"),
        logLevel: "silent",
        build: { emptyOutDir: true, outDir },
      });

      const files = await findFiles(outDir);
      const names = files.map((file) => file.replaceAll("\\", "/"));
      const cssFiles = files.filter((file) => file.endsWith(".css"));
      const css = (
        await Promise.all(cssFiles.map((file) => readFile(file, "utf8")))
      ).join("\n");
      const [managerHtml, overlayHtml] = await Promise.all([
        readFile(join(outDir, "index.html"), "utf8"),
        readFile(join(outDir, "overlay.html"), "utf8"),
      ]);

      expect(cssFiles.length).toBeGreaterThan(0);
      expect(managerHtml).toMatch(/href="[^"]+\.css"/);
      expect(overlayHtml).toMatch(/href="[^"]+\.css"/);
      expect(css).toContain("--color-ink-900:#12251f");
      expect(names.some((name) => /noto-sans-tc-.*\.woff2$/.test(name))).toBe(
        true,
      );
      expect(
        names.some((name) =>
          /press-start-2p-latin-400-normal-.*\.woff2$/.test(name),
        ),
      ).toBe(true);
      expect(
        names.some((name) =>
          /ibm-plex-mono-latin-400-normal-.*\.woff2$/.test(name),
        ),
      ).toBe(true);
      expect(css).toMatch(/url\([^)]*\.woff2\)/);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  }, 30_000);
});
