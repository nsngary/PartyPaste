type OrderedItem = { id: string };
type OrderField = "sortOrder" | "favoriteOrder";

export function reindexOrder<
  T extends OrderedItem,
  TField extends OrderField = "sortOrder",
>(
  items: readonly T[],
  field: TField = "sortOrder" as TField,
): Array<T & Record<TField, number>> {
  return items.map((item, index) => ({
    ...item,
    [field]: index,
  })) as Array<T & Record<TField, number>>;
}

export function reorderCompleteSet<
  T extends OrderedItem,
  TField extends OrderField = "sortOrder",
>(
  items: readonly T[],
  orderedIds: readonly string[],
  field: TField = "sortOrder" as TField,
): Array<T & Record<TField, number>> {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (
    orderedIds.length !== items.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !byId.has(id))
  ) {
    throw new Error("ordered ids must exactly match the sibling set");
  }
  return reindexOrder(
    orderedIds.map((id) => byId.get(id) as T),
    field,
  );
}

export function moveOrderedItem<T extends OrderedItem>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): Array<T & { sortOrder: number }> {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length
  ) {
    throw new Error("move index is outside the sibling set");
  }
  const moved = [...items];
  const [item] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, item);
  return reindexOrder(moved);
}
