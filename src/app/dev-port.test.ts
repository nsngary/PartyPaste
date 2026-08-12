import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigFromFile } from "vite";
import { describe, expect, it } from "vitest";

describe("desktop development server", () => {
  it("serves Vite on the Tauri dev URL port", async () => {
    const tauriConfig = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as { build: { devUrl: string } };
    const tauriDevPort = new URL(tauriConfig.build.devUrl).port;
    const viteConfig = await loadConfigFromFile(
      { command: "serve", mode: "development" },
      resolve(import.meta.dirname, "../../vite.config.ts"),
    );

    expect(viteConfig?.config.server?.port).toBe(Number(tauriDevPort));
  });
});
