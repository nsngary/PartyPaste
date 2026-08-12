import { describe, expect, it } from "vitest";
import { moveOrderedItem, reindexOrder, reorderCompleteSet } from "./ordering";

describe("ordering helpers", () => {
  it("reindexes siblings contiguously from zero", () => {
    expect(reindexOrder([{ id: "b" }, { id: "a" }])).toEqual([
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
    ]);
  });

  it("rejects incomplete, duplicate, or foreign reorder ids", () => {
    const siblings = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(() => reorderCompleteSet(siblings, ["b", "a"])).toThrow();
    expect(() => reorderCompleteSet(siblings, ["b", "b", "a"])).toThrow();
    expect(() => reorderCompleteSet(siblings, ["b", "a", "x"])).toThrow();
  });

  it("keeps group and favorite ordering independent", () => {
    const phrases = [
      { id: "a", sortOrder: 0, favoriteOrder: 1 },
      { id: "b", sortOrder: 1, favoriteOrder: 0 },
    ];
    const favorites = reorderCompleteSet(phrases, ["a", "b"], "favoriteOrder");
    expect(favorites).toEqual([
      { id: "a", sortOrder: 0, favoriteOrder: 0 },
      { id: "b", sortOrder: 1, favoriteOrder: 1 },
    ]);
  });

  it("supports 100 mixed moves without losing the ordering invariant", () => {
    let items = Array.from({ length: 11 }, (_, index) => ({
      id: `phrase-${index}`,
      sortOrder: index,
    }));
    for (let move = 0; move < 100; move += 1) {
      items = moveOrderedItem(
        items,
        move % items.length,
        (move * 7) % items.length,
      );
      expect(items.map((item) => item.sortOrder)).toEqual(
        Array.from({ length: items.length }, (_, index) => index),
      );
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    }
  });
});
