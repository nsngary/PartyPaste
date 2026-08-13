import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders, createPartyPasteI18n } from "../../i18n";
import { UpdateSettings } from "./UpdateSettings";

afterEach(cleanup);

describe("UpdateSettings", () => {
  it("shows the Task 12 update boundary without exposing install controls", () => {
    render(
      <AppProviders i18n={createPartyPasteI18n("en")}>
        <UpdateSettings />
      </AppProviders>,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Check for updates",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Signed updates will be enabled during release setup."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });
});
