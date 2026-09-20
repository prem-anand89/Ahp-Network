"use client";

// Phase 2 — native `<select multiple>` requires a ctrl/cmd-click to
// select more than one option, which doesn't exist as a gesture on
// Android/iOS; most mobile users can only ever pick one. This renders
// the same choice as tappable chips instead — each a real <button>
// (44px min height, so it's a legitimate touch target) toggling
// aria-pressed, not a hidden checkbox faked with CSS.

import { cn } from "@/lib/utils";

export interface ChipMultiSelectOption {
  value: string;
  label: string;
}

export interface ChipMultiSelectProps {
  options: ChipMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
  /** Caps how many can be selected at once (e.g. specialties); further
   * taps on an unselected chip are no-ops once the cap is reached. */
  max?: number;
}

export function ChipMultiSelect({ options, value, onChange, className, max }: ChipMultiSelectProps) {
  function toggle(optionValue: string) {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
      return;
    }
    if (max !== undefined && value.length >= max) return;
    onChange([...value, optionValue]);
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group">
      {options.map((option) => {
        const selected = value.includes(option.value);
        const disabled = !selected && max !== undefined && value.length >= max;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(option.value)}
            className={cn(
              "flex min-h-11 items-center rounded-pill border px-4 text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-graphite bg-transparent text-foreground hover:bg-accent",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
