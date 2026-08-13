import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VariableDefinitionWithPresets } from "../library/library-api";
import { VariableLibrary, type VariableLibraryApi } from "./VariableLibrary";

afterEach(cleanup);

const definitions: VariableDefinitionWithPresets[] = [
  {
    definition: {
      id: "v1",
      gameId: "game",
      name: "count",
      normalizedName: "count",
      sortOrder: 0,
    },
    presets: [
      { id: "p1", variableDefinitionId: "v1", value: "2", sortOrder: 0 },
    ],
  },
  {
    definition: {
      id: "v2",
      gameId: "game",
      name: "time",
      normalizedName: "time",
      sortOrder: 1,
    },
    presets: [],
  },
];

function makeApi(
  overrides: Partial<VariableLibraryApi> = {},
): VariableLibraryApi {
  return {
    listVariableDefinitions: vi.fn().mockResolvedValue(definitions),
    saveVariableDefinition: vi.fn().mockResolvedValue({
      status: "saved",
      value: {
        games: [],
        groups: [],
        phrases: [],
        variableDefinitions: [],
        variablePresets: [],
        phraseVariableRefs: [],
        settings: [],
      },
      undo: { operationId: "u", expiresAt: Date.now() + 10_000 },
    }),
    reorderVariableDefinitions: vi.fn().mockResolvedValue({}),
    reorderVariablePresets: vi.fn().mockResolvedValue({}),
    deleteVariableDefinition: vi.fn().mockResolvedValue({
      value: {},
      undo: { operationId: "u", expiresAt: Date.now() + 10_000 },
    }),
    ...overrides,
  };
}

describe("variable library", () => {
  it("creates, edits, reorders, and deletes game-scoped definitions", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<VariableLibrary api={api} gameId="game" onUndoReceipt={vi.fn()} />);
    await screen.findByText("{count}");
    await user.click(screen.getByRole("button", { name: "New variable" }));
    await user.type(
      screen.getByRole("textbox", { name: "Variable name" }),
      "time",
    );
    await user.click(screen.getByRole("button", { name: "Save variable" }));
    expect(api.saveVariableDefinition).toHaveBeenCalledWith({
      input: expect.objectContaining({
        gameId: "game",
        name: "time",
        renameConfirmed: false,
      }),
    });
    await user.click(screen.getByRole("button", { name: "Move count down" }));
    expect(api.reorderVariableDefinitions).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete count" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteVariableDefinition).toHaveBeenCalledWith({
      variableDefinitionId: "v1",
    });
  });

  it("previews a rename without mutation and sends explicit confirmation with impact counts", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValueOnce({
        status: "rename_confirmation_required",
        affectedPhraseCount: 3,
        affectedTokenCount: 5,
      })
      .mockResolvedValueOnce({
        status: "saved",
        value: {},
        undo: { operationId: "u", expiresAt: Date.now() + 10_000 },
      });
    const api = makeApi({ saveVariableDefinition: save });
    render(<VariableLibrary api={api} gameId="game" onUndoReceipt={vi.fn()} />);
    await screen.findByText("{count}");
    await user.click(screen.getByRole("button", { name: "Edit count" }));
    const input = screen.getByRole("textbox", { name: "Variable name" });
    await user.clear(input);
    await user.type(input, "players");
    await user.click(screen.getByRole("button", { name: "Save variable" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Confirm variable rename",
    });
    expect(dialog.textContent).toContain("3 phrases");
    expect(dialog.textContent).toContain("5 tokens");
    expect(save).toHaveBeenLastCalledWith({
      input: expect.objectContaining({ renameConfirmed: false }),
    });
    await user.click(screen.getByRole("button", { name: "Rename variable" }));
    expect(save).toHaveBeenLastCalledWith({
      input: expect.objectContaining({
        name: "players",
        renameConfirmed: true,
      }),
    });
  });

  it("rejects braces, control characters, and more than 40 Unicode scalars", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<VariableLibrary api={api} gameId="game" onUndoReceipt={vi.fn()} />);
    await screen.findByText("{count}");
    await user.click(screen.getByRole("button", { name: "New variable" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Variable name" }), {
      target: { value: "{invalid}" },
    });
    await user.click(screen.getByRole("button", { name: "Save variable" }));
    expect(screen.getByRole("alert").textContent).toContain("braces");
    expect(api.saveVariableDefinition).not.toHaveBeenCalled();
  });
});
