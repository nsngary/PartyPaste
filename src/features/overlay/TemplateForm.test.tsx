import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { TemplateForm } from "./TemplateForm";

afterEach(cleanup);

function renderForm(onCopy = vi.fn()) {
  const onClose = vi.fn();
  render(
    <AppProviders i18n={createPartyPasteI18n("en")}>
      <TemplateForm
        autoFocus
        bodyTemplate="Need {count} players at {time}"
        onClose={onClose}
        onCopy={onCopy}
        presets={{ count: ["1", "2"], time: ["20:00", "20:30"] }}
        title="Raid invite"
      />
    </AppProviders>,
  );
  return { onClose, onCopy };
}

describe("inline template form", () => {
  it("applies presets and custom values to a live preview before copying", async () => {
    const user = userEvent.setup();
    const { onCopy } = renderForm();
    const copy = screen.getByRole("button", { name: "Copy" });

    expect(copy.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Need {count} players at {time}")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.type(screen.getByRole("textbox", { name: "time" }), "21:15");

    expect(screen.getByText("Need 2 players at 21:15")).toBeTruthy();
    expect(copy.hasAttribute("disabled")).toBe(false);
    await user.click(copy);
    expect(onCopy).toHaveBeenCalledWith({ count: "2", time: "21:15" });
  });

  it("focuses the exact form and Escape discards temporary values", async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm();
    expect(
      screen
        .getByRole("group", { name: "Raid invite" })
        .contains(document.activeElement),
    ).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "count" }), "9");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
