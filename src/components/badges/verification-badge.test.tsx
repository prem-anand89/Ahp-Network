import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
  OwnershipVerifiedBadge,
} from "./verification-badge";
import {
  CREDENTIALS_VERIFIED_LABEL,
  QUALIFICATION_CONFIRMED_LABEL,
  OWNERSHIP_VERIFIED_LABEL,
} from "@/lib/copy";

describe("verification badges (plan §1A, §8C3 — locked module)", () => {
  it("renders the correct label for each tier, never a bare 'Verified'", () => {
    render(<CredentialsVerifiedBadge dateLabel="1 Sep 2026" />);
    expect(screen.getByText(CREDENTIALS_VERIFIED_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(/^Verified$/)).not.toBeInTheDocument();

    render(<QualificationConfirmedBadge dateLabel="1 Sep 2026" />);
    expect(screen.getByText(QUALIFICATION_CONFIRMED_LABEL)).toBeInTheDocument();

    render(<OwnershipVerifiedBadge dateLabel="1 Sep 2026" />);
    expect(screen.getByText(OWNERSHIP_VERIFIED_LABEL)).toBeInTheDocument();
  });

  it("tooltip is tap-triggered (a button/Popover), not hover-only — opens on click", async () => {
    const user = userEvent.setup();
    render(<CredentialsVerifiedBadge dateLabel="1 Sep 2026" />);

    expect(screen.queryByText(/An AHP Network admin has reviewed/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(CREDENTIALS_VERIFIED_LABEL) }));
    expect(await screen.findByText(/An AHP Network admin has reviewed/)).toBeInTheDocument();
  });

  it("each tier shows verbatim §1A copy distinct from the others", async () => {
    const user = userEvent.setup();

    render(<CredentialsVerifiedBadge dateLabel="1 Sep 2026" />);
    await user.click(screen.getByRole("button", { name: new RegExp(CREDENTIALS_VERIFIED_LABEL) }));
    expect(await screen.findByText(/not a clinical endorsement/)).toBeInTheDocument();

    render(<QualificationConfirmedBadge dateLabel="1 Sep 2026" />);
    await user.click(screen.getByRole("button", { name: new RegExp(QUALIFICATION_CONFIRMED_LABEL) }));
    expect(
      await screen.findByText(/does not unlock referral claiming or patient information/),
    ).toBeInTheDocument();

    render(<OwnershipVerifiedBadge dateLabel="1 Sep 2026" />);
    await user.click(screen.getByRole("button", { name: new RegExp(OWNERSHIP_VERIFIED_LABEL) }));
    expect(await screen.findByText(/business-registration document is on file/)).toBeInTheDocument();
  });

  it("the three badges use visually distinct shapes, not just colour", () => {
    const { container: verified } = render(<CredentialsVerifiedBadge dateLabel="1 Sep 2026" />);
    const { container: confirmed } = render(<QualificationConfirmedBadge dateLabel="1 Sep 2026" />);
    const { container: ownership } = render(<OwnershipVerifiedBadge dateLabel="1 Sep 2026" />);

    const verifiedClass = verified.querySelector("button")?.className ?? "";
    const confirmedClass = confirmed.querySelector("button")?.className ?? "";
    const ownershipClass = ownership.querySelector("button")?.className ?? "";

    expect(verifiedClass).toContain("rounded-full");
    expect(confirmedClass).toContain("rounded-md");
    expect(ownershipClass).toContain("rounded-none");

    // No two share the same shape class.
    const shapes = [verifiedClass, confirmedClass, ownershipClass].map(
      (c) => c.match(/rounded-\S+/)?.[0],
    );
    expect(new Set(shapes).size).toBe(3);
  });
});
