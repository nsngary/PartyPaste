import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWindowSettings } from "./useWindowSettings";

afterEach(cleanup);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("useWindowSettings", () => {
  it("registers before reading and preserves an event over stale read success or failure", async () => {
    const staleReads = [
      deferred<{ alwaysOnTop: boolean }>(),
      deferred<{ alwaysOnTop: boolean }>(),
    ];
    for (const [index, staleRead] of staleReads.entries()) {
      let handler: ((settings: { alwaysOnTop: boolean }) => void) | undefined;
      const order: string[] = [];
      const api = {
        subscribeToWindowSettings: async (
          next: (settings: { alwaysOnTop: boolean }) => void,
        ) => {
          order.push("listen");
          handler = next;
          return vi.fn();
        },
        getWindowSettings: vi.fn(() => {
          order.push("read");
          return staleRead.promise;
        }),
        toggleTopmost: vi.fn(),
      };
      const { result, unmount } = renderHook(() => useWindowSettings(api));
      await waitFor(() => expect(order).toEqual(["listen", "read"]));
      act(() => handler?.({ alwaysOnTop: true }));
      if (index === 0) staleRead.resolve({ alwaysOnTop: false });
      else staleRead.reject(new Error("stale"));
      await waitFor(() => expect(result.current.alwaysOnTop).toBe(true));
      expect(result.current.error).toBe(false);
      unmount();
    }
  });

  it("unregisters after unmount during registration and suppresses the read", async () => {
    const registration = deferred<() => void>();
    const stop = vi.fn();
    const getWindowSettings = vi.fn();
    const { unmount } = renderHook(() =>
      useWindowSettings({
        subscribeToWindowSettings: vi
          .fn()
          .mockReturnValue(registration.promise),
        getWindowSettings,
        toggleTopmost: vi.fn(),
      }),
    );
    unmount();
    registration.resolve(stop);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(getWindowSettings).not.toHaveBeenCalled();
  });

  it("surfaces registration and read failures and retries from unknown", async () => {
    const subscribe = vi.fn().mockRejectedValueOnce(new Error("listen"));
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("read"))
      .mockResolvedValue({ alwaysOnTop: true });
    const api = {
      subscribeToWindowSettings: subscribe,
      getWindowSettings: read,
      toggleTopmost: vi.fn(),
    };
    const { result } = renderHook(() => useWindowSettings(api));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.alwaysOnTop).toBeNull();
    act(() => result.current.retry());
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.alwaysOnTop).toBe(true));
  });
});
