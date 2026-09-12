import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Wrapped in React's per-request cache() so every caller in one render --
// the root layout, the page, anything they import -- gets the same instance.
// That matters for one reason: getUserSettings() is also cache()d and keyed
// on the client it is handed, so a shared client is what lets the layout and
// the page share a single settings read instead of each paying ~110ms to
// fetch the same row. Outside a request context cache() is a no-op and this
// behaves exactly as before.
export const createClient = cache(async function createClient() {
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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component; safe to ignore
            // because middleware refreshes the session on every request.
          }
        },
      },
    },
  );
});
