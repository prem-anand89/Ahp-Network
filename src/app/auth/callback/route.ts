// Google OAuth callback — exchanges the auth code for a session, then
// ensures the users/auth_identities rows exist (§8A, §10A) before
// redirecting into the app. Email OTP doesn't use this route: it verifies
// the code directly in a server action (see (auth)/login/actions.ts) since
// there's no redirect-based code exchange for that flow.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { ensureUserAndIdentities } from "@/app/actions/ensure-user";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const db = await getDb();
      await ensureUserAndIdentities(db, {
        id: data.user.id,
        email: data.user.email,
        identities: data.user.identities?.map((i) => ({ provider: i.provider, id: i.id })),
      });
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
