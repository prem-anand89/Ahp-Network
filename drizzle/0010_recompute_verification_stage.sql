-- Hand-written migration, tracked in the same journal as generated table
-- migrations (BUILD_SEQUENCE.md Phase 0's migration conventions).
--
-- [v19 §8A1a / CLAUDE.md non-negotiable] The ONLY writer of
-- users.verification_stage. Called from exactly two places: the admin
-- approve/reject action (this phase) and the credential-expiry job
-- (Phase 12). No route, server action, or migration writes the column
-- directly -- that discipline is what makes "verification_stage is only
-- ever advanced by a human admin action" actually enforced rather than
-- merely intended.
--
-- Hard rule tested below (see src/db/recompute-verification-stage.test.ts):
-- a council_registration credential linked to a professional_association
-- council (IAP) can be displayed but never by itself advances the stage to
-- credentials_verified. Only a link to a statutory_registration council
-- does -- this was never NCAHP-specific and stays flexible as NCAHP
-- enrollment grows.

CREATE OR REPLACE FUNCTION recompute_verification_stage(p_user_id UUID)
RETURNS profile_verification_stage
LANGUAGE plpgsql
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

-- Sync rule (§8A1a): an approved degree/PG credential gets a matching
-- Tier 1 course_completions row so it shows under "Core Clinical
-- Frameworks & Degrees" without the therapist re-entering it. One-way:
-- credentials stays the source of truth for gating, course_completions
-- for display. ON CONFLICT guards re-running this on the same credential
-- (e.g. a second admin approve click) from creating a duplicate row.
CREATE OR REPLACE FUNCTION sync_degree_to_course_completion(p_credential_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id UUID;
  v_type credential_type;
  v_label TEXT;
BEGIN
  SELECT user_id, type INTO v_user_id, v_type
  FROM credentials WHERE id = p_credential_id AND status = 'approved';

  IF v_type IS NULL OR v_type NOT IN ('degree', 'postgraduate_degree') THEN
    RETURN;
  END IF;

  v_label := CASE v_type
    WHEN 'degree' THEN 'Graduation'
    WHEN 'postgraduate_degree' THEN 'Postgraduate Degree'
  END;

  IF NOT EXISTS (
    SELECT 1 FROM course_completions
    WHERE user_id = v_user_id
      AND custom_course_name = v_label
      AND deleted_at IS NULL
  ) THEN
    INSERT INTO course_completions
      (user_id, custom_course_name, calculated_nomenclature, curation_status)
    VALUES (v_user_id, v_label, v_label, 'approved');
  END IF;
END;
$$;
