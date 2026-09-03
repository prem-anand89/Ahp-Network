// The "save-on-blur" half of the chunked form primitive (BUILD_SEQUENCE.md
// Phase 1). Used by onboarding, credential upload, practice creation, and
// referral posting — built once here rather than three slightly different
// times (ARCHITECTURE_REVIEW.md C7).
//
// Saves a field's value when it loses focus, but only if it actually
// changed since the last save — skips a network call on a field the user
// tabbed through without editing. Tracks per-field save state so the UI
// can show "Saved" / "Saving…" / an error inline, without a page-level
// submit button gating the whole form on every field being valid at once.

"use client";

import { useCallback, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseSaveOnBlurResult<T> {
  status: SaveStatus;
  error: string | null;
  /** Call this from the field's onBlur handler with the current value. */
  handleBlur: (value: T) => void;
}

export function useSaveOnBlur<T>(
  initialValue: T,
  save: (value: T) => Promise<void>,
): UseSaveOnBlurResult<T> {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedValue = useRef(initialValue);

  const handleBlur = useCallback(
    (value: T) => {
      if (Object.is(value, lastSavedValue.current)) return;

      setStatus("saving");
      setError(null);

      save(value)
        .then(() => {
          lastSavedValue.current = value;
          setStatus("saved");
        })
        .catch((err: unknown) => {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Save failed");
        });
    },
    [save],
  );

  return { status, error, handleBlur };
}
