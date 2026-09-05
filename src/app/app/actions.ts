"use server";

// §4 — sign-out for the /app/* therapist context. Nothing bespoke: just
// Supabase Auth's own signOut, same as every other auth call in this app.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
