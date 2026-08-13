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
    expect((await screen.findByRole("alert")).textContent).toBe(
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
