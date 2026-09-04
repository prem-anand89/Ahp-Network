// Browser Supabase client — for client components only (login form
// interactivity, session state). Server code uses ./server.ts instead;
// never share a client instance across the two, since the server client
// carries request-scoped cookies.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
