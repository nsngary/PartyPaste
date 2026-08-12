import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type CopySuccessDto,
  createCopyApi,
  type RecentCopyDto,
} from "./copy-api";

describe("clipboard command API", () => {
  it("copies a phrase with its temporary variable values", async () => {
    const result: CopySuccessDto = {
      phraseId: "phrase-1",
      title: "Raid invite",
      resolvedAt: 1_723_456_789_000,
      resolvedText: "Need 2 players at 20:30",
    };
    const invoke = vi.fn().mockResolvedValue(result);
    const api = createCopyApi(invoke);

    await expect(
      api.copyPhrase({
        phraseId: "phrase-1",
        variables: { count: "2", time: "20:30" },
      }),
    ).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("copy_phrase", {
      phraseId: "phrase-1",
      variables: { count: "2", time: "20:30" },
    });
    expectTypeOf(
      api.copyPhrase,
    ).returns.resolves.toEqualTypeOf<CopySuccessDto>();
  });

  it("loads recent copies without a persistence scope argument", async () => {
    const recent: RecentCopyDto[] = [
      {
        phraseId: "phrase-1",
        title: "Raid invite",
        resolvedAt: 1_723_456_789_000,
        resolvedText: "Need 2 players at 20:30",
      },
    ];
    const invoke = vi.fn().mockResolvedValue(recent);
    const api = createCopyApi(invoke);

    await expect(api.getRecentCopies()).resolves.toEqual(recent);
    expect(invoke).toHaveBeenCalledWith("get_recent_copies", {});
    expectTypeOf(api.getRecentCopies).returns.resolves.toEqualTypeOf<
      RecentCopyDto[]
    >();
  });
});
