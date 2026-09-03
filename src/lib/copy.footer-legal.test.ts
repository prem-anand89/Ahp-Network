// Build-failing test enforcing plan §1B: don't link to a Privacy Policy or
// Terms of Service page that doesn't exist yet, and don't publish the
// grievance address until a named admin is checking the inbox (§8G5's
// grievance_channel_published flag, default false). A 404 or a stub reads
// as evidence of an unfinished job to a therapist deciding whether to trust
// the platform with credential documents — worse than no link at all.

import { describe, expect, it } from "vitest";
import { FOOTER_LEGAL_LINKS, GRIEVANCE_OFFICER_EMAIL } from "./copy";

describe("footer legal gate (plan §1B)", () => {
  it("keeps every footer legal link's href empty until counsel delivers the real page", () => {
    for (const [key, link] of Object.entries(FOOTER_LEGAL_LINKS)) {
      expect(link.href, `${key}.href must stay null until the real page exists`).toBeNull();
    }
  });

  it("defines the grievance address as a constant, publication gated elsewhere by grievance_channel_published", () => {
    // This test only asserts the address exists as a single source of
    // truth. It cannot assert grievance_channel_published = false here —
    // that flag lives in the database (§8G5), not in this file — so the
    // actual publish gate is enforced at the component/route level in
    // Phase 1's admin context work, not by this test alone.
    expect(GRIEVANCE_OFFICER_EMAIL).toBe("grievance@ahpnetwork.in");
  });
});
