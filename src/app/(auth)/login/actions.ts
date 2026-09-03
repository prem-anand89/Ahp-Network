"use server";

// §4 — Google OAuth + email OTP, both via Supabase Auth natively. No
// custom code hashing, attempt counting, or code-lookup logic — that's the
// entire point of moving off the v17 custom magic-link implementation.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { ensureUserAndIdentities } from "@/app/actions/ensure-user";

export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
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
    options: { shouldCreateUser: true },
  });

  return error ? { error: error.message } : {};
}

export async function verifyOtpCode(email: string, token: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error || !data.user) {
    return { error: error?.message ?? "Verification failed" };
  }

  const db = await getDb();
  await ensureUserAndIdentities(db, {
    id: data.user.id,
    email: data.user.email,
    identities: data.user.identities?.map((i) => ({ provider: i.provider, id: i.id })),
  });

  redirect("/dashboard");
}
