-- Hand-written migration, tracked in the same journal as Drizzle-generated
-- table migrations — see BUILD_SEQUENCE.md Phase 0's migration conventions.
-- pg_trgm backs fuzzy matching for master_institutions / master_courses
-- curation (plan §8B2) and the directory search filters (plan §9).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
