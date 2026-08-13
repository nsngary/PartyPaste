import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("SettingsPage", () => {
  it("accepts a confirmed overlay event and sends the synchronized next intent", async () => {
    const user = userEvent.setup();
    let settingsHandler:
      | ((settings: { alwaysOnTop: boolean }) => void)
      | undefined;
    const settingsApi = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockResolvedValue(false),
      subscribeToWindowSettings: vi.fn(async (handler) => {
        settingsHandler = handler;
        return () => undefined;
      }),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <SettingsPage
          backupApi={{
            exportBackup: vi.fn(),
            previewImport: vi.fn(),
            replaceFromBackup: vi.fn(),
          }}
          fileDialog={{ openBackup: vi.fn(), saveBackup: vi.fn() }}
          settingsApi={settingsApi}
          shortcutApi={{
            getShortcuts: vi
              .fn()
              .mockResolvedValue({ overlay: "Ctrl+Shift+Space", phrases: {} }),
            setOverlayShortcut: vi.fn(),
          }}
        />
      </AppProviders>,
    );
    const topmost = await screen.findByRole("checkbox", {
      name: "Always on top",
    });
    settingsHandler?.({ alwaysOnTop: true });
    await waitFor(() =>
      expect((topmost as HTMLInputElement).checked).toBe(true),
    );
    await user.click(topmost);
    expect(settingsApi.toggleTopmost).toHaveBeenCalledWith(false);
  });

  it("does not let an older Manager response overwrite a newer overlay event", async () => {
    const user = userEvent.setup();
    let resolveToggle: (value: boolean) => void = () => undefined;
    const toggle = new Promise<boolean>((resolve) => {
      resolveToggle = resolve;
    });
    let settingsHandler:
      | ((settings: { alwaysOnTop: boolean }) => void)
      | undefined;
    const settingsApi = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockReturnValue(toggle),
      subscribeToWindowSettings: vi.fn(async (handler) => {
        settingsHandler = handler;
        return () => undefined;
      }),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <SettingsPage
          backupApi={{
            exportBackup: vi.fn(),
            previewImport: vi.fn(),
            replaceFromBackup: vi.fn(),
          }}
          fileDialog={{ openBackup: vi.fn(), saveBackup: vi.fn() }}
          settingsApi={settingsApi}
          shortcutApi={{
            getShortcuts: vi
              .fn()
              .mockResolvedValue({ overlay: "Ctrl+Shift+Space", phrases: {} }),
            setOverlayShortcut: vi.fn(),
          }}
        />
      </AppProviders>,
    );
    const topmost = await screen.findByRole("checkbox", {
      name: "Always on top",
    });
    await user.click(topmost);
    settingsHandler?.({ alwaysOnTop: false });
    resolveToggle(true);
    await waitFor(() =>
      expect((topmost as HTMLInputElement).disabled).toBe(false),
    );
    expect((topmost as HTMLInputElement).checked).toBe(false);
  });

  it("prevents a stale rapid topmost toggle while persistence is pending", async () => {
    const user = userEvent.setup();
    let resolveToggle: (value: boolean) => void = () => undefined;
    const toggle = new Promise<boolean>((resolve) => {
      resolveToggle = resolve;
    });
    const settingsApi = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockReturnValue(toggle),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <SettingsPage
          backupApi={{
            exportBackup: vi.fn(),
            previewImport: vi.fn(),
            replaceFromBackup: vi.fn(),
          }}
          fileDialog={{ openBackup: vi.fn(), saveBackup: vi.fn() }}
          settingsApi={settingsApi}
          shortcutApi={{
            getShortcuts: vi.fn().mockResolvedValue({
              overlay: "Ctrl+Shift+Space",
              phrases: {},
            }),
            setOverlayShortcut: vi.fn(),
          }}
        />
      </AppProviders>,
    );
    const topmost = await screen.findByRole("checkbox", {
      name: "Always on top",
    });
    await user.click(topmost);
    expect((topmost as HTMLInputElement).disabled).toBe(true);
    await user.click(topmost);
    expect(settingsApi.toggleTopmost).toHaveBeenCalledTimes(1);
    resolveToggle(true);
    await waitFor(() =>
      expect((topmost as HTMLInputElement).disabled).toBe(false),
    );
    expect((topmost as HTMLInputElement).checked).toBe(true);
  });

  it("switches language immediately and persists the overlay topmost preference", async () => {
    const user = userEvent.setup();
    const i18n = createPartyPasteI18n("zh-TW");
    const settingsApi = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockResolvedValue(true),
    };

    render(
      <AppProviders i18n={i18n}>
        <SettingsPage
          backupApi={{
            exportBackup: vi.fn(),
            previewImport: vi.fn(),
            replaceFromBackup: vi.fn(),
          }}
          fileDialog={{ openBackup: vi.fn(), saveBackup: vi.fn() }}
          settingsApi={settingsApi}
          shortcutApi={{
            getShortcuts: vi.fn().mockResolvedValue({
              overlay: "Ctrl+Shift+Space",
              phrases: {},
            }),
            setOverlayShortcut: vi.fn(),
          }}
        />
      </AppProviders>,
    );

    expect(await screen.findByRole("heading", { name: "設定" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "English" }));
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeTruthy();

    const topmost = screen.getByRole("checkbox", { name: "Always on top" });
    await user.click(topmost);
    expect(settingsApi.toggleTopmost).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect((topmost as HTMLInputElement).checked).toBe(true),
    );
  });

  it("restores the topmost control and keeps sanitized native failures in the current language", async () => {
    const user = userEvent.setup();
    const i18n = createPartyPasteI18n("en");
    const settingsApi = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: true }),
      toggleTopmost: vi.fn().mockRejectedValue(new Error("C:/secret.db")),
    };

    render(
      <AppProviders i18n={i18n}>
        <SettingsPage
          backupApi={{
            exportBackup: vi.fn(),
            previewImport: vi.fn(),
            replaceFromBackup: vi.fn(),
          }}
          fileDialog={{ openBackup: vi.fn(), saveBackup: vi.fn() }}
          settingsApi={settingsApi}
          shortcutApi={{
            getShortcuts: vi.fn().mockResolvedValue({
              overlay: "Ctrl+Shift+Space",
              phrases: {},
            }),
            setOverlayShortcut: vi.fn(),
          }}
        />
      </AppProviders>,
    );

    const topmost = await screen.findByRole("checkbox", {
      name: "Always on top",
    });
    await waitFor(() =>
      expect((topmost as HTMLInputElement).checked).toBe(true),
    );
    await user.click(topmost);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not save this overlay setting.",
    );
    expect(screen.queryByText(/secret\.db/)).toBeNull();
    expect((topmost as HTMLInputElement).checked).toBe(true);
  });
});
