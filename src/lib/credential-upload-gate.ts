// Phase 4 bug fix — extracted from src/app/app/verification/page.tsx so
// the gating rule is directly testable. The upload form used to gate on
// `mine.length === 0`, so a therapist whose only credential hit
// query_raised had NO control at all — their only recourse was emailing
// an identity document to the founder over consumer email. The real gate
// is "nothing currently being reviewed, and nothing already approved" —
// query_raised and rejected both leave the door open to try again, since
// verification is never a permanent bar.

export interface CredentialForGate {
  status: "pending" | "under_review" | "query_raised" | "approved" | "rejected";
}

export function canUploadCredential(credentials: CredentialForGate[]): boolean {
  const hasActiveReview = credentials.some((c) => c.status === "pending" || c.status === "under_review");
  const hasApproved = credentials.some((c) => c.status === "approved");
  return !hasActiveReview && !hasApproved;
}
