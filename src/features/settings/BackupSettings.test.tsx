import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { BackupSettings } from "./BackupSettings";
import type { ImportPreviewDto } from "./backup-api";

afterEach(cleanup);

describe("BackupSettings", () => {
  it("confirms the destination before exporting through the existing backup API", async () => {
    const user = userEvent.setup();
    const api = {
      exportBackup: vi.fn().mockResolvedValue(undefined),
      previewImport: vi.fn(),
      replaceFromBackup: vi.fn(),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <BackupSettings
          api={api}
          fileDialog={{
            openBackup: vi.fn(),
            saveBackup: vi.fn().mockResolvedValue("C:/safe/backup.json"),
          }}
        />
      </AppProviders>,
    );

    await user.click(screen.getByRole("button", { name: "Export backup" }));
    expect(api.exportBackup).not.toHaveBeenCalled();
    expect(screen.queryByText("C:/safe/backup.json")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm export" }));
    expect(api.exportBackup).toHaveBeenCalledWith("C:/safe/backup.json");
    expect((await screen.findByRole("status")).textContent).toBe(
      "Backup exported.",
    );
  });

  it("previews counts and requires replacement confirmation without exposing the path", async () => {
    const user = userEvent.setup();
    const api = {
      exportBackup: vi.fn(),
      previewImport: vi.fn().mockResolvedValue({
        previewToken: "token",
        expiresAt: 123,
        gameCount: 2,
        groupCount: 4,
        phraseCount: 12,
        variableDefinitionCount: 3,
        variablePresetCount: 5,
        phraseVariableRefCount: 6,
        shortcutConflictCount: 1,
      }),
      replaceFromBackup: vi.fn().mockResolvedValue(undefined),
    };
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <BackupSettings
          api={api}
          fileDialog={{
            openBackup: vi.fn().mockResolvedValue("C:/private/restore.json"),
            saveBackup: vi.fn(),
          }}
        />
      </AppProviders>,
    );

    await user.click(screen.getByRole("button", { name: "Import backup" }));
    expect(api.previewImport).toHaveBeenCalledWith("C:/private/restore.json");
    expect(
      await screen.findByText("2 games, 4 groups, 12 phrases"),
    ).toBeTruthy();
    expect(screen.queryByText("C:/private/restore.json")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Replace library" }));
    expect(api.replaceFromBackup).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirm replacement" }),
    );
    expect(api.replaceFromBackup).toHaveBeenCalledWith(
      "C:/private/restore.json",
      "token",
    );
  });

  it("prevents a second file operation while an import preview is pending", async () => {
    let resolvePreview: ((value: ImportPreviewDto) => void) | undefined;
    const previewImport = vi.fn(
      () =>
        new Promise<ImportPreviewDto>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <BackupSettings
          api={{
            exportBackup: vi.fn(),
            previewImport,
            replaceFromBackup: vi.fn(),
          }}
          fileDialog={{
            openBackup: vi.fn().mockResolvedValue("C:/private/restore.json"),
            saveBackup: vi.fn(),
          }}
        />
      </AppProviders>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Import backup" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Export backup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    resolvePreview?.({
      previewToken: "token",
      expiresAt: 123,
      gameCount: 0,
      groupCount: 0,
      phraseCount: 0,
      variableDefinitionCount: 0,
      variablePresetCount: 0,
      phraseVariableRefCount: 0,
      shortcutConflictCount: 0,
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Export backup",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });
});
