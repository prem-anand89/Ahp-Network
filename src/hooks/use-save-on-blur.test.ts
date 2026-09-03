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
});
