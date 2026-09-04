-- Hand-written seed migration, tracked in the same journal as generated
-- table migrations (BUILD_SEQUENCE.md Phase 0's migration conventions).
--
-- [H4] Pilot-zone areas only. Full-city curation (~100-150 rows across
-- 6-8 parent zones, plan §6) is ongoing founder content work that does
-- not block Phase 6 -- this seed covers the pilot zone
-- (Kondapur/Gachibowli/Madhapur) and its immediate neighbouring zones,
-- enough for matching to be correct and for a therapist to describe a
-- realistic home-visit area. More zones/localities are added the same
-- way, on an ongoing basis, never by editing this file after the fact.
--
-- ancestor_ids is maintained by hand here (a fixed, small, admin-curated
-- tree), matching the schema comment in src/db/schema.ts -- a trigger
-- would be overkill for content that changes by admin action, not by
-- application traffic.

DO $$
DECLARE
  v_hyderabad_id uuid;
  v_west_zone_id uuid;
  v_kondapur_id uuid;
  v_gachibowli_id uuid;
  v_madhapur_id uuid;
  v_secunderabad_zone_id uuid;
BEGIN
  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids)
  VALUES (gen_random_uuid(), 'Hyderabad', 'hyderabad', 'city', NULL, '{}')
  RETURNING id INTO v_hyderabad_id;

  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids)
  VALUES (gen_random_uuid(), 'West Zone', 'west-zone', 'zone', v_hyderabad_id, ARRAY[v_hyderabad_id])
  RETURNING id INTO v_west_zone_id;

  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids)
  VALUES (gen_random_uuid(), 'Secunderabad Zone', 'secunderabad-zone', 'zone', v_hyderabad_id, ARRAY[v_hyderabad_id])
  RETURNING id INTO v_secunderabad_zone_id;

  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids)
  VALUES (gen_random_uuid(), 'Kondapur', 'kondapur', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id])
  RETURNING id INTO v_kondapur_id;

  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids)
  VALUES (gen_random_uuid(), 'Gachibowli', 'gachibowli', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id])
  RETURNING id INTO v_gachibowli_id;

  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids)
  VALUES (gen_random_uuid(), 'Madhapur', 'madhapur', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id])
  RETURNING id INTO v_madhapur_id;

  -- Immediate neighbours of the pilot zone -- enough for the §8D empty-pool
  -- parent-zone fallback to have somewhere real to widen into, without
  -- claiming full-city coverage yet.
  INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids) VALUES
    ('Hitech City', 'hitech-city', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id]),
    ('Jubilee Hills', 'jubilee-hills', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id]),
    ('Banjara Hills', 'banjara-hills', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id]),
    ('Kukatpally', 'kukatpally', 'locality', v_west_zone_id, ARRAY[v_hyderabad_id, v_west_zone_id]),
    ('Secunderabad', 'secunderabad', 'locality', v_secunderabad_zone_id, ARRAY[v_hyderabad_id, v_secunderabad_zone_id]),
    ('Begumpet', 'begumpet', 'locality', v_secunderabad_zone_id, ARRAY[v_hyderabad_id, v_secunderabad_zone_id]);
END $$;

-- master_councils -- [plan §8A1a / CLAUDE.md] hand-curated, never
-- auto-created. Pilot seed is meant to be exactly three rows: TGPMB,
-- NCAHP, IAP. TGPMB is deliberately withheld here: the plan requires
-- confirming its actual professional-registration function (not just
-- paramedical course admissions) directly before seeding it, and that
-- confirmation is still an open real-world fact per
-- ARCHITECTURE_REVIEW.md §F / BUILD_SEQUENCE.md Phase 2. Seed it in a
-- follow-up migration once confirmed -- do not infer the answer from
-- documentation and seed it here.
INSERT INTO master_councils (name, council_type, state, applicable_role) VALUES
  ('NCAHP', 'statutory_registration', NULL, NULL),
  ('IAP', 'professional_association', NULL, 'physiotherapist');

-- Certification allow-list for auto-generated communities (Phase 9,
-- plan §2/§8E3) -- curated internationally-recognised bodies only, to
-- avoid a long tail of near-empty communities for one-off local workshop
-- certificates. No community logic here, just the flag Phase 9 reads.
INSERT INTO master_courses_certifications
  (name, normalized_name, category, tier, nomenclature, eligible_for_community_auto_generation)
VALUES
  ('Mulligan Concept', 'mulligan concept', 'manual_therapy', 'international_accredited_certification', 'Mulligan Concept', true),
  ('Maitland Concept', 'maitland concept', 'manual_therapy', 'international_accredited_certification', 'Maitland Concept', true),
  ('McKenzie Method / MDT', 'mckenzie method mdt', 'manual_therapy', 'international_accredited_certification', 'McKenzie Method (MDT)', true),
  ('Cyriax Approach', 'cyriax approach', 'manual_therapy', 'international_accredited_certification', 'Cyriax Approach', true),
  ('PNF (Proprioceptive Neuromuscular Facilitation)', 'pnf proprioceptive neuromuscular facilitation', 'exercise_therapeutic', 'international_accredited_certification', 'PNF', true),
  ('Bobath Concept / NDT', 'bobath concept ndt', 'other', 'international_accredited_certification', 'Bobath Concept (NDT)', true),
  ('Barral Institute Visceral Manipulation', 'barral institute visceral manipulation', 'manual_therapy', 'international_accredited_certification', 'Barral Visceral Manipulation', true)
ON CONFLICT DO NOTHING;
