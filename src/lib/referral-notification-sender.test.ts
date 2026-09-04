import { describe, expect, it } from "vitest";
import { buildNotificationMessage } from "./referral-notification-sender";

describe("buildNotificationMessage — §8G4", () => {
  it("has a human-readable message for every template the three referral functions enqueue", () => {
    const templates = [
      "referral_posted_match",
      "referral_offered",
      "referral_accepted",
      "referral_went_to_someone_else",
      "referral_missed_choose_again",
    ];
    for (const template of templates) {
      const message = buildNotificationMessage(template);
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.body.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic message for an unrecognized template rather than throwing", () => {
    expect(() => buildNotificationMessage("something_new")).not.toThrow();
  });
});
