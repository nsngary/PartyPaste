import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhraseInspector } from "./PhraseInspector";

afterEach(cleanup);

const phrase = {
  id: "p",
  groupId: "g",
  title: "Ready",
  bodyTemplate: "Ready?",
  favorite: false,
  favoriteOrder: null,
  hotkey: null,
  sortOrder: 0,
} as const;

describe("phrase inspector", () => {
  it("validates exact Unicode scalar limits and invalid template syntax", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <PhraseInspector phrase={phrase} onCancel={vi.fn()} onSave={onSave} />,
    );
    const title = screen.getByRole("textbox", { name: "Phrase title" });
    fireEvent.change(title, { target: { value: "😀".repeat(121) } });
    await user.click(screen.getByRole("button", { name: "Save phrase" }));
    expect(screen.getByRole("alert").textContent).toContain("120");
    const body = screen.getByRole("textbox", { name: "Phrase body" });
    await user.clear(title);
    await user.type(title, "Valid");
    fireEvent.change(body, { target: { value: "Need {count" } });
    await user.click(screen.getByRole("button", { name: "Save phrase" }));
    expect(screen.getByRole("alert").textContent).toContain("template");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("asks before discarding dirty edits and cancels immediately when pristine", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <PhraseInspector phrase={phrase} onCancel={onCancel} onSave={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.type(
      screen.getByRole("textbox", { name: "Phrase title" }),
      " changed",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("dialog", { name: "Discard changes?" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
