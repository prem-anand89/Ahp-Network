// Named proxy.ts, not middleware.ts — this Next.js version deprecated the
// middleware file convention in favor of "proxy" (same mechanism, same
// per-request hook, new name and export). Refreshes the Supabase session
// cookie on every request that isn't a static asset — the standard
// @supabase/ssr pattern for Next.js. Without this, a session can expire
// mid-visit and server components see a stale cookie until the next full
// navigation.
//
// Deliberately does NOT gate any route here — that's the authz module's
// job (src/lib/authz.ts), invoked per-action inside (app) route handlers
// and server actions, not via redirects from here. Keeping auth checks out
// of this file avoids exactly the "one cookies() call in a shared layout"
// static-generation trap this app already guards against with route
// groups — this runs on every request regardless, but it must never
// become the place business-logic gating lives.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
