// Phase 2 — the staleness fix: a jade "Available for new patients" dot
// left untouched for 21+ days now reads as neutral, not as fresh
// forever. Covers the three cases computeAvailabilityDisplay produces
// that ProfileCard actually renders differently.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProfileCard, type ProfileCardProps } from "./profile-card";

afterEach(cleanup);

function baseProps(overrides: Partial<ProfileCardProps> = {}): ProfileCardProps {
  return {
    slug: "test-therapist",
    displayName: "Test Therapist",
    photoUrl: null,
    role: "physiotherapist",
    specializations: [],
    verificationStage: "credentials_verified",
    capacityState: "available",
    availabilityUpdatedAt: new Date(),
    ...overrides,
  };
}

describe("ProfileCard availability display (Phase 2)", () => {
  it("shows the fresh jade line when confirmed within 21 days", () => {
    render(<ProfileCard {...baseProps({ availabilityUpdatedAt: new Date() })} />);
    expect(screen.getByText("Available for new patients")).toBeInTheDocument();
  });

  it("shows the staleness line, not the fresh claim, once 21+ days have passed", () => {
    const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    render(<ProfileCard {...baseProps({ availabilityUpdatedAt: staleDate })} />);
    expect(screen.getByText("Availability not confirmed recently")).toBeInTheDocument();
    expect(screen.queryByText("Available for new patients")).not.toBeInTheDocument();
  });

  it("shows neither line for an explicit not_accepting", () => {
    render(
      <ProfileCard {...baseProps({ capacityState: "not_taking", availabilityUpdatedAt: new Date() })} />,
    );
    expect(screen.queryByText("Available for new patients")).not.toBeInTheDocument();
    expect(screen.queryByText("Availability not confirmed recently")).not.toBeInTheDocument();
  });

  it("shows neither line when the therapist never touched the toggle", () => {
    render(<ProfileCard {...baseProps({ capacityState: "not_taking", availabilityUpdatedAt: null })} />);
    expect(screen.queryByText("Available for new patients")).not.toBeInTheDocument();
    expect(screen.queryByText("Availability not confirmed recently")).not.toBeInTheDocument();
  });
});
