import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { OverlayHeader, type OverlayTopmostApi } from "./OverlayHeader";

afterEach(cleanup);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderHeader(api: OverlayTopmostApi) {
  return render(
    <AppProviders i18n={createPartyPasteI18n("en")}>
      <OverlayHeader
        games={[{ id: "game", name: "Game" }] as never}
        onSelectGame={vi.fn()}
        selectedGameId="game"
        topmostApi={api}
      />
    </AppProviders>,
  );
}

describe("OverlayHeader topmost control", () => {
  it("uses an unknown loading semantic until native state arrives", () => {
    renderHeader({
      getWindowSettings: vi.fn().mockReturnValue(new Promise(() => undefined)),
      toggleTopmost: vi.fn(),
    });
    const button = screen.getByRole("button", { name: "Loading pin setting" });
    expect(button.getAttribute("aria-pressed")).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("accepts a confirmed Manager change and toggles from that synchronized value", async () => {
    const user = userEvent.setup();
    let settingsHandler:
      | ((settings: { alwaysOnTop: boolean }) => void)
      | undefined;
    const api = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockResolvedValue(false),
      subscribeToWindowSettings: vi.fn(async (handler) => {
        settingsHandler = handler;
        return () => undefined;
      }),
    };
    renderHeader(api);
    await screen.findByRole("button", { name: "Pin overlay" });
    settingsHandler?.({ alwaysOnTop: true });
    await user.click(
      await screen.findByRole("button", { name: "Unpin overlay" }),
    );
    expect(api.toggleTopmost).toHaveBeenCalledWith(false);
  });

  it("does not let an older click response overwrite a newer Manager event", async () => {
    const user = userEvent.setup();
    const change = deferred<boolean>();
    let settingsHandler:
      | ((settings: { alwaysOnTop: boolean }) => void)
      | undefined;
    renderHeader({
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockReturnValue(change.promise),
      subscribeToWindowSettings: vi.fn(async (handler) => {
        settingsHandler = handler;
        return () => undefined;
      }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Pin overlay" }),
    );
    settingsHandler?.({ alwaysOnTop: false });
    change.resolve(true);
    expect(
      await screen.findByRole("button", { name: "Pin overlay" }),
    ).toBeTruthy();
  });

  it("loads pinned state and applies one keyboard toggle while the request is pending", async () => {
    const user = userEvent.setup();
    const change = deferred<boolean>();
    const api = {
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: true }),
      toggleTopmost: vi.fn().mockReturnValue(change.promise),
    };
    const { container } = renderHeader(api);

    const button = await screen.findByRole("button", { name: "Unpin overlay" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(api.toggleTopmost).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Enter}{Enter}");
    expect(api.toggleTopmost).toHaveBeenCalledTimes(1);
    change.resolve(false);

    expect(
      (await screen.findByRole("button", {
        name: "Pin overlay",
      })) as HTMLButtonElement,
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Pin overlay",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(container.querySelector("header")?.scrollWidth).toBeLessThanOrEqual(
      240,
    );
  });

  it("keeps the previous state and shows a sanitized failure", async () => {
    const user = userEvent.setup();
    renderHeader({
      getWindowSettings: vi.fn().mockResolvedValue({ alwaysOnTop: false }),
      toggleTopmost: vi.fn().mockRejectedValue(new Error("C:/secret.db")),
    });

    await user.click(
      await screen.findByRole("button", { name: "Pin overlay" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not save this overlay setting.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Pin overlay",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByText(/secret\.db/)).toBeNull();
  });
});
