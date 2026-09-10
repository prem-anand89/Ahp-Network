// Server Supabase client — for server components, server actions, and
// route handlers. Reads/writes the session via Next.js's cookies() API,
// which is why any route using this becomes dynamic (see the /app/* route
// group's layout.tsx, which already accepts that cost — never call this
// from anything under (public)).

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies — safe
            // to ignore as long as src/proxy.ts is refreshing the session,
            // which it is.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user's id, verified LOCALLY — no network call.
 *
 * `getUser()` is a real HTTP round trip to Supabase's Auth API on every
 * single call. That was the largest fixed cost in every /app/* navigation:
 * once in src/proxy.ts and again in the page body, both crossing to the
 * Supabase region before any query ran. `getClaims()` verifies the JWT
 * signature with WebCrypto against the project's public JWKS instead, so
 * the common case costs no network at all.
 *
 * REQUIRES the project to use ASYMMETRIC JWT signing keys (Dashboard →
 * Auth → JWT Keys). @supabase/auth-js is explicit: "If your project is
 * using a symmetric secret to sign the JWT, it always sends a request
 * similar to getUser() to validate the JWT at the server." So on a
 * symmetric-secret project this is still correct — just no faster. It
 * also still refreshes an about-to-expire session, exactly as getUser()
 * did, so proxy.ts's cookie-refresh duty is unchanged.
 *
 * `cache()` scopes the memo to one request, so a page that needs the id
 * more than once pays for it once. Returns null when not signed in.
 *
 * Use `getUser()` instead — deliberately — wherever a *fresh server-side*
 * check is the point rather than an optimisation target: admin
 * re-authentication (§8G5), first-signup identity capture, and the OAuth
 * callback. Those are cold paths and are meant to hit the Auth server.
 */
export const getVerifiedUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});
