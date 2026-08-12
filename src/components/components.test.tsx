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

  it("makes the application background inert and restores its exact state", async () => {
    const user = userEvent.setup();
    const preHiddenSibling = document.createElement("div");
    preHiddenSibling.inert = true;
    preHiddenSibling.setAttribute("inert", "inert");
    preHiddenSibling.setAttribute("aria-hidden", "false");
    document.body.append(preHiddenSibling);

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          <Dialog open={open} title="Settings" onClose={() => setOpen(false)}>
            <button type="button">Done</button>
          </Dialog>
        </>
      );
    }

    try {
      const { container } = render(<Harness />);
      const initialContainerInert = container.inert;
      const initialContainerInertAttribute = container.getAttribute("inert");
      await user.click(screen.getByRole("button", { name: "Open settings" }));

      const dialog = screen.getByRole("dialog", { name: "Settings" });
      const activePortal = dialog.parentElement;
      expect(container.inert).toBe(true);
      expect(container.getAttribute("aria-hidden")).toBe("true");
      expect(preHiddenSibling.inert).toBe(true);
      expect(preHiddenSibling.getAttribute("inert")).toBe("");
      expect(preHiddenSibling.getAttribute("aria-hidden")).toBe("true");
      expect(activePortal?.inert).not.toBe(true);
      expect(activePortal?.hasAttribute("inert")).toBe(false);
      expect(activePortal?.hasAttribute("aria-hidden")).toBe(false);

      await user.keyboard("{Escape}");
      expect(container.inert).toBe(initialContainerInert);
      expect(container.getAttribute("inert")).toBe(
        initialContainerInertAttribute,
      );
      expect(container.hasAttribute("aria-hidden")).toBe(false);
      expect(preHiddenSibling.inert).toBe(true);
      expect(preHiddenSibling.getAttribute("inert")).toBe("inert");
      expect(preHiddenSibling.getAttribute("aria-hidden")).toBe("false");
    } finally {
      preHiddenSibling.remove();
    }
  });

  it("keeps the outer modal isolated until a nested drawer closes", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [dialogOpen, setDialogOpen] = useState(false);
      const [drawerOpen, setDrawerOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDialogOpen(true)}>
            Open editor
          </button>
          <Dialog
            open={dialogOpen}
            title="Phrase editor"
            onClose={() => setDialogOpen(false)}
          >
            <button type="button" onClick={() => setDrawerOpen(true)}>
              Open inspector
            </button>
            <Drawer
              open={drawerOpen}
              title="Phrase inspector"
              onClose={() => setDrawerOpen(false)}
            >
              <button type="button">Apply</button>
            </Drawer>
          </Dialog>
        </>
      );
    }

    const { container } = render(<Harness />);
    const applicationOpener = screen.getByRole("button", {
      name: "Open editor",
    });
    await user.click(applicationOpener);
    const nestedOpener = screen.getByRole("button", { name: "Open inspector" });
    const outerDialog = screen.getByRole("dialog", { name: "Phrase editor" });
    const outerPortal = outerDialog.parentElement;
    await user.click(nestedOpener);

    expect(
      screen.getByRole("dialog", { name: "Phrase inspector" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("dialog", { name: "Phrase editor", hidden: true }),
    ).toBeTruthy();
    expect(outerPortal?.inert).toBe(true);
    expect(outerPortal?.getAttribute("aria-hidden")).toBe("true");
    expect(container.inert).toBe(true);

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Phrase inspector" }),
    ).toBeNull();
    expect(screen.getByRole("dialog", { name: "Phrase editor" })).toBeTruthy();
    expect(outerPortal?.inert).not.toBe(true);
    expect(outerPortal?.hasAttribute("aria-hidden")).toBe(false);
    expect(container.inert).toBe(true);
    expect(nestedOpener).toBe(document.activeElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.inert).not.toBe(true);
    expect(container.hasAttribute("aria-hidden")).toBe(false);
    expect(applicationOpener).toBe(document.activeElement);
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
