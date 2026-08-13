import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresetEditor } from "./PresetEditor";

afterEach(cleanup);

describe("preset editor", () => {
  it("adds, edits, removes, and explicitly reorders user presets", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const presets = [
      { id: "a", value: "2", sortOrder: 0 },
      { id: "b", value: "4", sortOrder: 1 },
    ];
    const { rerender } = render(
      <PresetEditor onChange={onChange} presets={presets} />,
    );
    await user.click(screen.getByRole("button", { name: "Move 4 up" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "b", value: "4", sortOrder: 0 },
      { id: "a", value: "2", sortOrder: 1 },
    ]);
    await user.click(screen.getByRole("button", { name: "Remove 2" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "b", value: "4", sortOrder: 0 },
    ]);
    rerender(<PresetEditor onChange={onChange} presets={[]} />);
    await user.type(screen.getByRole("textbox", { name: "New preset" }), "8");
    await user.click(screen.getByRole("button", { name: "Add preset" }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ value: "8", sortOrder: 0 }),
    ]);
  });

  it("rejects empty values and more than 200 Unicode scalars", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PresetEditor onChange={onChange} presets={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "New preset" }), {
      target: { value: "😀".repeat(201) },
    });
    await user.click(screen.getByRole("button", { name: "Add preset" }));
    expect(screen.getByRole("alert").textContent).toContain("200");
    expect(onChange).not.toHaveBeenCalled();
  });
});
