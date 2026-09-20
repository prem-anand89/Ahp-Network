// Split out of the admin verification actions.ts: a "use server" file may
// only export async functions (and types, which erase) — a class export
// broke the build the exact same way src/lib/place-search-errors.ts's
// header describes for practices/actions.ts. Caught proactively here
// rather than waiting for `next build` to find it again.
export class RegistrationNumberMismatchError extends Error {
  constructor() {
    super("The registration number you typed doesn't match what's on file for this credential.");
    this.name = "RegistrationNumberMismatchError";
  }
}
