// Phase 2 polish — step dot-strip, back button, and sessionStorage
// persistence across an accidental reload mid-flow. Round 3 step C
// rewrote step 2 into three national screens (city, base locality,
// coverage); both the areas server actions and the onboarding server
// actions are mocked here — this tests the client-side step machinery,
// not the DB writes (those are onboarding.test.ts's and area-search's
// own coverage).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingFlow } from "./onboarding-flow";

vi.mock("./actions", () => ({
  submitProfileStep2: vi.fn(async () => ({ count: 12, isFoundingCohortFraming: false })),
  markLocalityContextShown: vi.fn(async () => {}),
}));

const CITY_RESULT = {
  id: "city-1",
  name: "Hyderabad",
  slug: "hyderabad",
  areaLevel: "city" as const,
  cityAreaId: "city-1",
  cityName: "Hyderabad",
  pincode: null,
  label: "Hyderabad, Telangana",
};

const LOCALITY_RESULT = {
  id: "loc-1",
  name: "Kondapur",
  slug: "kondapur",
  areaLevel: "locality" as const,
  cityAreaId: "city-1",
  cityName: "Hyderabad",
  pincode: "500084",
  label: "Kondapur, Test Zone, Hyderabad, Telangana",
};

const CITY_TREE = {
  cityId: "city-1",
  cityName: "Hyderabad",
  zones: [
    {
      id: "zone-1",
      name: "Test Zone",
      slug: "test-zone",
      localities: [{ id: "loc-1", name: "Kondapur", slug: "kondapur" }],
    },
  ],
  unzoned: [],
};

vi.mock("@/app/app/areas/actions", () => ({
  searchAreasAction: vi.fn(async (query: string, opts?: { levels?: string[] }) => {
    if (opts?.levels?.includes("city")) return [CITY_RESULT];
    if (opts?.levels?.includes("locality")) return [LOCALITY_RESULT];
    return [];
  }),
  getCityAreaTreeAction: vi.fn(async () => CITY_TREE),
  proposeLocalityAction: vi.fn(async () => ({ id: "new-loc", name: "New Place" })),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

beforeEach(() => {
  sessionStorage.clear();
});

async function completeProfileStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Your name"), "Priya Nair");
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Physiotherapist" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function completeCityStep(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByPlaceholderText("Search city, or a 6-digit PIN");
  await user.type(input, "Hyd");
  await user.click(await screen.findByRole("button", { name: /Hyderabad/ }));
}

async function completeLocalityStep(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByPlaceholderText("Search a locality in Hyderabad");
  await user.type(input, "Kon");
  await user.click(await screen.findByRole("button", { name: /Kondapur/ }));
}

async function completeCoverageStep(user: ReturnType<typeof userEvent.setup>) {
  // "Test Zone" renders once under Primary and once under Secondary.
  await screen.findAllByText("Test Zone");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function runFullFlow(user: ReturnType<typeof userEvent.setup>) {
  await completeProfileStep(user);
  await completeCityStep(user);
  await completeLocalityStep(user);
  await completeCoverageStep(user);
}

describe("OnboardingFlow (Phase 2 polish, Round 3 national flow)", () => {
  it("renders a step dot-strip, not a progress bar", () => {
    render(<OnboardingFlow />);
    const dotStrip = document.querySelector('[role="presentation"]');
    expect(dotStrip?.querySelectorAll(".rounded-pill")).toHaveLength(6);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("has no back button on the first (profile) step", () => {
    render(<OnboardingFlow />);
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
  });

  it("walks city → locality → coverage, submitting once with the picked base area", async () => {
    const user = userEvent.setup();
    const { submitProfileStep2 } = await import("./actions");
    render(<OnboardingFlow />);

    await runFullFlow(user);

    await waitFor(() => expect(submitProfileStep2).toHaveBeenCalledTimes(1));
    expect(submitProfileStep2).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Priya Nair",
        role: "physiotherapist",
        baseAreaId: "loc-1",
        coverage: expect.arrayContaining([expect.objectContaining({ areaId: "loc-1", tier: "primary" })]),
      }),
    );
    expect(await screen.findByText(/already active in this area/)).toBeInTheDocument();
  });

  it("stepping back from 2.5 to coverage doesn't re-submit", async () => {
    const user = userEvent.setup();
    const { submitProfileStep2 } = await import("./actions");
    render(<OnboardingFlow />);

    await runFullFlow(user);
    await screen.findByText(/already active in this area/);
    expect(submitProfileStep2).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Back/ }));
    await screen.findAllByText("Test Zone");
    expect(submitProfileStep2).toHaveBeenCalledTimes(1);
  });

  it("persists step and field values across an unmount/remount (simulated reload)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingFlow />);

    await runFullFlow(user);
    await screen.findByText(/already active in this area/);
    unmount();

    // A remount (the reload this simulates) restores step 2.5, not the
    // first step — the whole point is that reloading mid-flow doesn't
    // rewind to the start.
    render(<OnboardingFlow />);
    expect(await screen.findByText(/already active in this area/)).toBeInTheDocument();
  });
});
