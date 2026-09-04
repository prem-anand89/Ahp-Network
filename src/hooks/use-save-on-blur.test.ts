import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useSaveOnBlur } from "./use-save-on-blur";

afterEach(cleanup);

describe("useSaveOnBlur", () => {
  it("saves on blur when the value changed", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveOnBlur<string>("initial", save));

    act(() => result.current.handleBlur("changed"));

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledWith("changed");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("skips the save call when the value is unchanged — no network call for an unedited field", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveOnBlur<string>("same", save));

    act(() => result.current.handleBlur("same"));

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("surfaces an error without crashing, and leaves the field editable", async () => {
    const save = vi.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useSaveOnBlur<string>("initial", save));

    act(() => result.current.handleBlur("changed"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("network down");
  });

  it("does not re-save the same value twice in a row", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveOnBlur<string>("initial", save));

    act(() => result.current.handleBlur("changed"));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    act(() => result.current.handleBlur("changed"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a slow earlier save resolving after a fast later save does not stomp the later result", async () => {
    // save("A") is slow; save("B") is fast and resolves first. A's
    // resolution arriving late must not overwrite B's "saved" status or
    // reset lastSavedValue back to "A".
    let resolveA!: () => void;
    const save = vi.fn((value: string) => {
      if (value === "A") return new Promise<void>((resolve) => (resolveA = resolve));
      return Promise.resolve();
    });
    const { result } = renderHook(() => useSaveOnBlur<string>("initial", save));

    act(() => result.current.handleBlur("A"));
    act(() => result.current.handleBlur("B"));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    resolveA();
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.status).toBe("saved");

    // Blurring "B" again should be a no-op — lastSavedValue must be "B",
    // not stale "A" from the superseded resolution.
    act(() => result.current.handleBlur("B"));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("a slow earlier save that later rejects does not surface a false error after a later save succeeded", async () => {
    let rejectA!: (err: Error) => void;
    const save = vi.fn((value: string) => {
      if (value === "A") return new Promise<void>((_, reject) => (rejectA = reject));
      return Promise.resolve();
    });
    const { result } = renderHook(() => useSaveOnBlur<string>("initial", save));

    act(() => result.current.handleBlur("A"));
    act(() => result.current.handleBlur("B"));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    rejectA(new Error("stale failure"));
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
  });
});
