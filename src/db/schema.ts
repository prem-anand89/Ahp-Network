// Drizzle schema — source of truth for generated migrations (drizzle-kit
// generate + migrate, never push). Real tables land in Phase 1 (Identity
// core) onward, per BUILD_SEQUENCE.md. Phase 0 only needs this file to exist
// so the migration pipeline itself is provable end-to-end.
//
// Hand-written SQL migrations (extensions, PL/pgSQL functions, views, role
// grants/revocations) are tracked in the same drizzle journal alongside
// generated ones — see drizzle/ and BUILD_SEQUENCE.md Phase 0's migration
// conventions note.

export {};
