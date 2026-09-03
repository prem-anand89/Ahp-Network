// Server Supabase client — for server components, server actions, and
// route handlers. Reads/writes the session via Next.js's cookies() API,
// which is why any route using this becomes dynamic (see the (app) route
// group's layout.tsx, which already accepts that cost — never call this
// from anything under (public)).

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
            // to ignore as long as middleware.ts is refreshing the session,
            // which it is (see src/middleware.ts).
          }
        },
      },
    },
  );
}
