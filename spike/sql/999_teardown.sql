-- Drops the Phase 0.5 spike schema from wherever it was loaded (local ahp_spike
-- database, or the isolated phase05_spike schema in the real Ahp-Network Supabase
-- project). Run this once results are recorded — nothing here should persist.
DROP SCHEMA IF EXISTS phase05_spike CASCADE;
