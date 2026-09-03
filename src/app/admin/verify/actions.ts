"use server";

// §8G5 — "re-authentication to enter admin mode." Re-verifies the ALREADY
// signed-in account's own email via a fresh OTP code — never a place to
// switch identities, so the email isn't asked for, only read from the
// existing session.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_MODE_COOKIE_NAME, currentAdminModeCookieValue } from "@/lib/admin-session";

export async function sendAdminVerifyCode(): Promise<{ error?: string; email?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });

  return error ? { error: error.message } : { email: user.email };
}

export async function verifyAdminCode(email: string, token: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Enforce the invariant this module's header comment claims: the email
  // being verified must be the CURRENT session's own email, never a
  // client-supplied value taken on faith. A server action is a callable
  // endpoint, not just UI-reachable code — without this check, nothing
  // stopped a direct call from re-authenticating the session as a
  // different email entirely.
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser?.email || currentUser.email !== email) {
    return { error: "Email does not match the current session" };
  }

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error || !data.user) {
    return { error: error?.message ?? "Verification failed" };
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_MODE_COOKIE_NAME, currentAdminModeCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/admin",
    maxAge: 60 * 60 * 24,
  });

  redirect("/admin");
}
