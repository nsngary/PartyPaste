import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../styles/controls.css";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { Field } from "./Field";
import { IconButton } from "./IconButton";
import { SegmentedControl } from "./SegmentedControl";
import { ToastRegion } from "./ToastRegion";

afterEach(cleanup);

describe("PartyPaste design-system primitives", () => {
  it("gives text and icon buttons dependable accessible names", () => {
    render(
      <>
        <Button>儲存片語</Button>
        <IconButton label="關閉" icon={<span aria-hidden="true">×</span>} />
      </>,
    );

    expect(screen.getByRole("button", { name: "儲存片語" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "關閉" })).toBeTruthy();
  });

  it("connects field requirements, help, and errors to the form control", () => {
    render(
      <Field
        label="Phrase title"
        description="Shown in title-only mode"
        error="Enter a title"
        required
      >
        <input />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "Phrase title" });
    expect(input.hasAttribute("required")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const descriptions = (input.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(descriptions).toEqual(["Shown in title-only mode", "Enter a title"]);
  });

  it("traps dialog focus, closes on Escape, and restores the opener", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      const firstField = useRef<HTMLInputElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Edit phrase
          </button>
          <Dialog
            open={open}
            title="Edit phrase"
            initialFocusRef={firstField}
            onClose={() => setOpen(false)}
          >
            <input ref={firstField} aria-label="Phrase title" />
            <button type="button">Save</button>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Edit phrase" });
    await user.click(opener);

    expect(screen.getByRole("dialog", { name: "Edit phrase" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Phrase title" })).toBe(
      document.activeElement,
    );

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save" })).toBe(
      document.activeElement,
    );
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Phrase title" })).toBe(
      document.activeElement,
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toBe(document.activeElement);
  });

  it("exposes an open drawer as a labelled modal and closes it with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Drawer open title="Phrase inspector" onClose={onClose}>
        <button type="button">Done</button>
      </Drawer>,
    );

    const drawer = screen.getByRole("dialog", { name: "Phrase inspector" });
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("announces confirmations politely and errors assertively", () => {
    render(
      <ToastRegion
        label="Notifications"
        toasts={[
          { id: "copied", message: "Copied", tone: "success" },
          { id: "failed", message: "Clipboard unavailable", tone: "error" },
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(within(region).getByRole("status").textContent).toBe("Copied");
    expect(within(region).getByRole("alert").textContent).toBe(
      "Clipboard unavailable",
    );
  });

  it("supports roving focus and selection with arrow, Home, and End keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Display mode"
        value="title"
        onChange={onChange}
        options={[
          { value: "title", label: "Title only" },
          { value: "full", label: "Full sentence" },
          { value: "preview", label: "Preview", disabled: true },
        ]}
      />,
    );

    const title = screen.getByRole("radio", { name: "Title only" });
    title.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("full");
    expect(screen.getByRole("radio", { name: "Full sentence" })).toBe(
      document.activeElement,
    );
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("full");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("title");
  });

  it("keeps an enabled segment keyboard-reachable when the value is unavailable", () => {
    render(
      <SegmentedControl
        ariaLabel="Display mode"
        value="retired"
        onChange={() => undefined}
        options={[
          { value: "title", label: "Title only" },
          { value: "retired", label: "Retired", disabled: true },
        ]}
      />,
    );

    expect(screen.getByRole("radio", { name: "Title only" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Retired" }).tabIndex).toBe(-1);
  });

  it("has no serious or critical axe violations in representative controls", async () => {
    const { container } = render(
      <main>
        <Field label="Phrase title" description="Shown in title-only mode">
          <input />
        </Field>
        <SegmentedControl
          ariaLabel="Display mode"
          value="title"
          onChange={() => undefined}
          options={[
            { value: "title", label: "Title only" },
            { value: "full", label: "Full sentence" },
          ]}
        />
        <Button>Save</Button>
      </main>,
    );

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    await waitFor(() => {
      expect(
        results.violations.filter(({ impact }) =>
          ["serious", "critical"].includes(impact ?? ""),
        ),
      ).toEqual([]);
    });
  });
});
