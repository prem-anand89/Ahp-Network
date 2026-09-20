// Phase 2 polish — step dot-strip, back button, and sessionStorage
// persistence across an accidental reload mid-flow. Server actions are
// mocked: this tests the client-side step machinery, not the DB write
// (that's submitProfileStep2's own coverage in onboarding.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingFlow } from "./onboarding-flow";

vi.mock("./actions", () => ({
  submitProfileStep2: vi.fn(async () => ({ count: 12, isFoundingCohortFraming: false })),
  markLocalityContextShown: vi.fn(async () => {}),
}));

const ZONES = [
  {
    zone: { id: "zone-1", name: "Test Zone", slug: "test-zone", areaLevel: "zone" as const, parentId: null },
    localities: [
      { id: "loc-1", name: "Kondapur", slug: "kondapur", areaLevel: "locality" as const, parentId: "zone-1" },
    ],
  },
];

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

beforeEach(() => {
  sessionStorage.clear();
});

async function fillStep2AndContinue(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Your name"), "Priya Nair");
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Physiotherapist" }));
  await user.click(screen.getByRole("button", { name: "Kondapur" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("OnboardingFlow (Phase 2 polish)", () => {
  it("renders a step dot-strip, not a progress bar", () => {
    render(<OnboardingFlow zones={ZONES} />);
    // Three pill-shaped dot elements in the dedicated dot-strip container,
    // no numeric/percentage progress text.
    const dotStrip = document.querySelector('[role="presentation"]');
    expect(dotStrip?.querySelectorAll(".rounded-pill")).toHaveLength(3);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("has no back button on step 2 (there's nothing before it in this flow)", () => {
    render(<OnboardingFlow zones={ZONES} />);
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
  });

  it("advancing to step 2.5 shows a back button that returns to step 2 without re-submitting", async () => {
    const user = userEvent.setup();
    const { submitProfileStep2 } = await import("./actions");
    render(<OnboardingFlow zones={ZONES} />);

    await fillStep2AndContinue(user);
    expect(await screen.findByRole("button", { name: /Back/ })).toBeInTheDocument();
    expect(submitProfileStep2).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByLabelText("Your name")).toHaveValue("Priya Nair");
    expect(submitProfileStep2).toHaveBeenCalledTimes(1);
  });

  it("persists step and field values across an unmount/remount (simulated reload)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingFlow zones={ZONES} />);

    await fillStep2AndContinue(user);
    await screen.findByRole("button", { name: /Back/ });
    unmount();

    // A remount (the reload this simulates) restores step 2.5, not step
    // 2 — the whole point is that reloading mid-flow doesn't rewind to
    // the start. Stepping back from the restored 2.5 proves the earlier
    // field values survived too, not just the step number.
    render(<OnboardingFlow zones={ZONES} />);
    expect(await screen.findByText(/already active in this area/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByLabelText("Your name")).toHaveValue("Priya Nair");
  });
});
