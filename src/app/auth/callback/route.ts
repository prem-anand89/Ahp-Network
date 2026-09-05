// Shared callback for both PKCE-style redirects: Google OAuth, and the
// click-through link in the email-OTP message (its emailRedirectTo now
// points here too, see (auth)/login/actions.ts). Exchanges the code for a
// session, then ensures the users/auth_identities rows exist (§8A, §10A)
// before redirecting into the app. The OTP flow's primary path — typing
// the 6-digit code into the login form — still never touches this route;
// verifyOtpCode in (auth)/login/actions.ts verifies that directly.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { ensureUserAndIdentities } from "@/app/actions/ensure-user";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const db = await getDb();
      await ensureUserAndIdentities(
        db,
        {
          id: data.user.id,
          email: data.user.email,
          identities: data.user.identities?.map((i) => ({ provider: i.provider, id: i.id })),
        },
        request.cookies.get("ahp_ref")?.value,
      );
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
