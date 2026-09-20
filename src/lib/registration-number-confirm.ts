// Phase 4 — "did you actually look?" as a mechanism, not a question. The
// comparison itself, extracted so it's testable without an admin session
// or a database. Credentials with no registration number on file (most
// degrees/postgraduate degrees) have nothing to re-type — the check is a
// no-op for those, since this mechanism is specifically about the
// number, not a generic confirmation dialog.
export function registrationNumberMatches(onFile: string | null, typed: string | undefined): boolean {
  if (!onFile) return true;
  return onFile === (typed ?? "").trim();
}
