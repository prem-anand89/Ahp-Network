-- TGPMB (Telangana State Physiotherapy and Medical Board) — the real-world
-- fact BUILD_SEQUENCE.md Phase 2 and ARCHITECTURE_REVIEW.md §F left open:
-- migration 0007 seeded NCAHP and IAP but deliberately withheld TGPMB
-- pending direct confirmation that it covers post-qualification
-- professional registration for practicing physiotherapists, not just
-- paramedical course admissions. Confirmed by the founder: TGPMB is a
-- mandatory state-level registration for practicing physiotherapists in
-- Telangana. `statutory_registration`, not `professional_association` —
-- this is the classification CLAUDE.md's non-negotiable rule reads
-- directly: a council_registration credential only advances a user's
-- verification_stage to credentials_verified when linked to a
-- statutory_registration council, never a professional_association one.
INSERT INTO master_councils (name, council_type, state, applicable_role) VALUES
  ('TGPMB', 'statutory_registration', 'Telangana', 'physiotherapist');
