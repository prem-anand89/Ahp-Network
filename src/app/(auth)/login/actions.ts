"use server";

// §4 — Google OAuth + email OTP, both via Supabase Auth natively. No
// custom code hashing, attempt counting, or code-lookup logic — that's the
// entire point of moving off the v17 custom magic-link implementation.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { ensureUserAndIdentities } from "@/app/actions/ensure-user";

function safeNextPath(nextPath?: string): string {
  if (nextPath?.startsWith("/app/") || nextPath?.startsWith("/admin")) {
    return nextPath;
  }
  return "/app/dashboard";
}

export async function signInWithGoogle(nextPath?: string) {
  const supabase = await createClient();
  const redirectTo = new URL(`${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`);
  const destination = safeNextPath(nextPath);
  if (destination !== "/app/dashboard") {
    redirectTo.searchParams.set("next", destination);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo.toString(),
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth_init_failed");
  }
  redirect(data.url);
}

export async function sendOtpCode(email: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  // shouldCreateUser: true — signup and sign-in are the same flow, per §4's
  // simplification. Supabase Auth sends a 6-digit code by default for this
  // call (channel: 'email' is implicit); the click-through link inside the
  // same email is the secondary path §4 describes for desktop.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // Without this, the click-through link in the OTP email falls back
      // to whatever "Site URL" is configured in the Supabase dashboard —
      // which defaults to localhost and stays that way until someone
      // updates it there. The 6-digit code path (verifyOtpCode below)
      // never needed this, which is exactly why the bug went unnoticed:
      // it only breaks the secondary, link-based path §4 describes for
      // desktop, never the primary one.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  return error ? { error: error.message } : {};
}

export async function verifyOtpCode(
  email: string,
  token: string,
  nextPath?: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error || !data.user) {
    return { error: error?.message ?? "Verification failed" };
  }

  const db = await getDb();
  const cookieStore = await cookies();
  await ensureUserAndIdentities(
    db,
    {
      id: data.user.id,
      email: data.user.email,
      identities: data.user.identities?.map((i) => ({ provider: i.provider, id: i.id })),
    },
    cookieStore.get("ahp_ref")?.value,
  );

  redirect(safeNextPath(nextPath));
}
