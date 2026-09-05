// Named proxy.ts, not middleware.ts — this Next.js version deprecated the
// middleware file convention in favor of "proxy" (same mechanism, same
// per-request hook, new name and export). Refreshes the Supabase session
// cookie on every request that isn't a static asset — the standard
// @supabase/ssr pattern for Next.js. Without this, a session can expire
// mid-visit and server components see a stale cookie until the next full
// navigation.
//
// Deliberately does NOT run business-logic authz here — that's
// src/lib/authz.ts, invoked per-action inside route handlers and server
// actions. Session *presence* for /app/* and /admin/* is gated below so
// layout redirect() never fires during client-side navigation (see the
// comment on that block). Keeping richer admin-role checks in the admin
// layouts is intentional.
//
// [§8G5] Also refreshes the admin-mode sliding idle window here, for the
// same structural reason as the Supabase cookie above: `cookies().set()`
// is only valid from a Server Action, Route Handler, or this per-request
// hook — never from a Server Component's render body, which is what
// src/app/admin/(protected)/layout.tsx is. That layout still does the
// authoritative read-and-redirect check; it just never calls .set() itself.
//
// §8A4 — also captures a `?ref=<code>` query param into a short-lived
// cookie, for the same structural reason: a visitor can land on a shared
// profile URL (`?ref=` per §10F) long before they authenticate, and OAuth's
// redirect chain doesn't reliably carry arbitrary app query params through
// to the callback. ensureUserAndIdentities reads this cookie once, at
// first signup only — it's never read again after that.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_MODE_COOKIE_NAME,
  currentAdminModeCookieValue,
  isAdminSessionActive,
  parseAdminModeCookie,
} from "@/lib/admin-session";

// Kept as a bare literal rather than imported from src/lib/invites.ts —
// this file runs on every request (see the matcher below) and shouldn't
// pull in that module's drizzle-orm/schema imports just for one string.
// Must match INVITE_REF_COOKIE_NAME there exactly.
const INVITE_REF_COOKIE_NAME = "ahp_ref";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Auth redirects belong here, not in /app/* or /admin/* layouts — layout
  // redirect() throws NEXT_REDIRECT during client-side (RSC) navigation and
  // surfaces as a broken nav click; proxy returns a normal redirect response
  // that the router handles cleanly on both full loads and soft transitions.
  if (pathname.startsWith("/app")) {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  } else if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/verify")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login?next=/admin", request.url));
    }
  }

  const refCode = request.nextUrl.searchParams.get("ref");
  if (refCode) {
    response.cookies.set(INVITE_REF_COOKIE_NAME, refCode, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days — generous enough to survive a slow signup decision
    });
  }

  if (request.nextUrl.pathname.startsWith("/admin")) {
    const lastActivity = parseAdminModeCookie(
      request.cookies.get(ADMIN_MODE_COOKIE_NAME)?.value,
    );
    // Only refresh an already-active session — an expired or missing
    // cookie is left alone so the layout's redirect to /admin/verify
    // still fires.
    if (isAdminSessionActive(lastActivity)) {
      response.cookies.set(ADMIN_MODE_COOKIE_NAME, currentAdminModeCookieValue(), {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/admin",
        maxAge: 60 * 60 * 24,
      });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
