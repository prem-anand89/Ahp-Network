// Shared callback for both PKCE-style redirects: Google OAuth, and the
// click-through link in the email-OTP message (its emailRedirectTo now
// points here too, see (auth)/login/actions.ts). Exchanges the code for a
// session, then ensures the users/auth_identities rows exist (§8A, §10A)
// before redirecting into the app. The OTP flow's primary path — typing
// the 6-digit code into the login form — still never touches this route;
// verifyOtpCode in (auth)/login/actions.ts verifies that directly.
//
// Excluded from proxy.ts's matcher (see that file) — a real production
// failure traced to this route running getClaims() there too, in the same
// request cycle as the exchange below. Kept resilient here regardless:
// a PKCE code is single-use, so a duplicate/racing request to this exact
// URL (observed from India on a mobile connection — a retried request is
// the leading theory, though the exact browser-side trigger was never
// pinned down) surfaces as exchangeCodeForSession failing with
// `flow_state_not_found` even though a sibling request's exchange already
// succeeded. Previously that meant a Supabase Auth identity got created
// with no corresponding users/auth_identities row ever provisioned, and
// the failure was silently swallowed — no log, no way to diagnose it after
// the fact. Both fixed below.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { ensureUserAndIdentities } from "@/app/actions/ensure-user";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app/dashboard";
  const supabase = await createClient();

  let authUser: { id: string; email?: string; identities?: { provider: string; id: string }[] | null } | null = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("auth/callback: exchangeCodeForSession failed", error.message, error.code);
    } else if (data.user) {
      authUser = data.user;
    }
  }

  // Fallback for the exact race above: this request's cookie jar may
  // already hold a valid session set by a sibling request's successful
  // exchange, even though *this* request's own exchange (if it ran) lost
  // the race on the single-use code. Checking getUser() rather than
  // trusting exchangeCodeForSession's own result is what makes
  // ensureUserAndIdentities run in that case instead of silently skipping.
  if (!authUser) {
    const { data } = await supabase.auth.getUser();
    if (data.user) authUser = data.user;
  }

  if (authUser) {
    const db = await getDb();
    try {
      await ensureUserAndIdentities(
        db,
        {
          id: authUser.id,
          email: authUser.email,
          identities: authUser.identities?.map((i) => ({ provider: i.provider, id: i.id })),
        },
        request.cookies.get("ahp_ref")?.value,
      );
    } catch (err) {
      // A session genuinely exists at this point (Supabase Auth confirmed
      // it) — never bounce back to /login over a provisioning error alone;
      // log it and let the app's own "no profile" handling surface it
      // instead of masking a real session behind the generic auth error.
      console.error("auth/callback: ensureUserAndIdentities failed", err);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
