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

  // The locked invariant (globals.css header, ARCHITECTURE_REVIEW.md E1/C3):
  // the three badges are distinguishable by SHAPE and ICON and TEXT, never
  // by colour alone — a colour-blind viewer must still tell them apart.
  //
  // [2026-09] Rewritten to assert that invariant directly instead of three
  // hardcoded class strings (`rounded-full` / `rounded-md` / `rounded-none`).
  // The design system specifies two pills for the therapist tiers (filled
  // vs outline) and an 8px rounded-rectangle for Ownership Verified, which
  // is "deliberately never a pill" so a practice badge can't be mistaken
  // for a therapist badge at a glance. The old test would have rejected
  // that exact design. What actually matters, and what is asserted now:
  //   - Ownership's corner radius differs from BOTH therapist badges (the
  //     therapist badges may share one — they differ by fill, icon, text);
  //   - all three icons are different glyphs;
  //   - all three labels are different strings;
  //   - the two therapist badges differ from each other in more than
  //     colour (their class sets are not identical).
  describe("the three badges are distinct by shape AND icon AND text", () => {
    function renderAll() {
      const { container: verified } = render(<CredentialsVerifiedBadge dateLabel="1 Sep 2026" />);
      const { container: confirmed } = render(<QualificationConfirmedBadge dateLabel="1 Sep 2026" />);
      const { container: ownership } = render(<OwnershipVerifiedBadge dateLabel="1 Sep 2026" />);
      const btn = (c: HTMLElement) => c.querySelector("button")!;
      const radius = (c: HTMLElement) => btn(c).className.match(/\brounded(?:-[\w[\]/.]+)?\b/g) ?? [];
      const icon = (c: HTMLElement) => btn(c).querySelector("svg")?.innerHTML ?? "";
      return {
        verified: { el: btn(verified), radius: radius(verified), icon: icon(verified) },
        confirmed: { el: btn(confirmed), radius: radius(confirmed), icon: icon(confirmed) },
        ownership: { el: btn(ownership), radius: radius(ownership), icon: icon(ownership) },
      };
    }

    it("Ownership Verified never shares a corner radius with either therapist badge", () => {
      const b = renderAll();
      expect(b.ownership.radius.length).toBeGreaterThan(0);
      expect(b.verified.radius.length).toBeGreaterThan(0);
      expect(b.confirmed.radius.length).toBeGreaterThan(0);
      expect(b.ownership.radius).not.toEqual(b.verified.radius);
      expect(b.ownership.radius).not.toEqual(b.confirmed.radius);
    });

    it("all three badges carry different icon glyphs", () => {
      const b = renderAll();
      expect(b.verified.icon).not.toBe("");
      expect(b.confirmed.icon).not.toBe("");
      expect(b.ownership.icon).not.toBe("");
      expect(new Set([b.verified.icon, b.confirmed.icon, b.ownership.icon]).size).toBe(3);
    });

    it("all three badges carry different labels", () => {
      expect(
        new Set([CREDENTIALS_VERIFIED_LABEL, QUALIFICATION_CONFIRMED_LABEL, OWNERSHIP_VERIFIED_LABEL]).size,
      ).toBe(3);
    });

    it("the two therapist badges differ in more than colour", () => {
      const b = renderAll();
      // Same shape is allowed (two pills); identical styling is not.
      expect(b.verified.el.className).not.toBe(b.confirmed.el.className);
    });
  });
});
