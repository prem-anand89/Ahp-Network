import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipMultiSelect } from "./chip-multi-select";

afterEach(cleanup);

const OPTIONS = [
  { value: "musculoskeletal_orthopaedic", label: "Musculoskeletal / Orthopaedic" },
  { value: "neuro_rehab", label: "Neuro Rehab" },
];

describe("ChipMultiSelect (Phase 2 — native select multiple is unusable on Android)", () => {
  it("renders every option as a real button, not a hidden checkbox", () => {
    render(<ChipMultiSelect options={OPTIONS} value={[]} onChange={() => {}} />);
    for (const option of OPTIONS) {
      expect(screen.getByRole("button", { name: option.label })).toBeInTheDocument();
    }
  });

  it("marks selected options with aria-pressed=true", () => {
    render(<ChipMultiSelect options={OPTIONS} value={["neuro_rehab"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Neuro Rehab" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Musculoskeletal / Orthopaedic" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking an unselected chip adds it to the selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipMultiSelect options={OPTIONS} value={[]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Neuro Rehab" }));
    expect(onChange).toHaveBeenCalledWith(["neuro_rehab"]);
  });

  it("clicking a selected chip removes it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipMultiSelect options={OPTIONS} value={["neuro_rehab"]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Neuro Rehab" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("respects a max cap — further taps on an unselected chip are no-ops", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChipMultiSelect
        options={OPTIONS}
        value={["neuro_rehab"]}
        onChange={onChange}
        max={1}
      />,
    );
    const other = screen.getByRole("button", { name: "Musculoskeletal / Orthopaedic" });
    expect(other).toBeDisabled();
    await user.click(other);
    expect(onChange).not.toHaveBeenCalled();
  });
});
