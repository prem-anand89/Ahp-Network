-- Round 3 step B — closes a real gap the new therapist-facing "my
-- council isn't listed" proposal path (verification/actions.ts) would
-- otherwise open: recompute_verification_stage()'s statutory-registration
-- check only tested master_councils.council_type = 'statutory_registration',
-- never curation_status. A pending_review council (one a therapist just
-- proposed, never reviewed) could already grant credentials_verified the
-- moment an admin approved the CREDENTIAL row, without the admin having
-- separately approved the council itself — contradicting CLAUDE.md's
-- "master_councils is hand-curated, never auto-created... at any
-- confidence score." This was unreachable before Round 3 (nothing let a
-- therapist create a master_councils row at all), so it's a closed gap,
-- not a regression.
--
-- CREATE OR REPLACE resets a function's SET clauses (CLAUDE.md's own
-- warning, from the 0036/shortlist_referral incident) — search_path is
-- pinned INLINE here, not as a separate ALTER FUNCTION like 0011 did,
-- specifically so a future CREATE OR REPLACE of this function can't
-- silently drop it again.
CREATE OR REPLACE FUNCTION recompute_verification_stage(p_user_id UUID)
RETURNS profile_verification_stage
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_degree BOOLEAN;
  v_has_statutory_registration BOOLEAN;
  v_stage profile_verification_stage;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM credentials
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND type IN ('degree', 'postgraduate_degree')
      AND deleted_at IS NULL
      AND (expiry_date IS NULL OR expiry_date > now())
  ) INTO v_has_degree;

  SELECT EXISTS (
    SELECT 1 FROM credentials c
    JOIN master_councils mc ON mc.id = c.council_id
    WHERE c.user_id = p_user_id
      AND c.status = 'approved'
      AND c.type = 'council_registration'
      AND c.deleted_at IS NULL
      AND (c.expiry_date IS NULL OR c.expiry_date > now())
      AND mc.council_type = 'statutory_registration'
      AND mc.curation_status = 'approved'
      AND mc.is_active = true
  ) INTO v_has_statutory_registration;

  IF v_has_degree AND v_has_statutory_registration THEN
    v_stage := 'credentials_verified';
  ELSIF v_has_degree THEN
    v_stage := 'qualification_confirmed';
  ELSE
    v_stage := 'unverified';
  END IF;

  UPDATE users SET verification_stage = v_stage, updated_at = now()
  WHERE id = p_user_id;

  RETURN v_stage;
END;
$$;
