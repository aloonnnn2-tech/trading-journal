import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Route handlers and Server Components used to each call `getUser()`
// themselves purely to read `user.id` and gate access -- a second real
// network round-trip to Supabase Auth on top of this one. Since this
// middleware already does the one verification that matters, it forwards
// the resolved id downstream via this header so nothing else has to ask
// again. See src/lib/supabase/auth.ts for the reading side.
const USER_ID_HEADER = "x-user-id";

export async function proxy(request: NextRequest) {
  // getUser() can trigger a token refresh mid-call, which needs new cookies
  // written to both the outgoing request (so this same request sees them)
  // and the response (so the browser does). Collected here instead of
  // applied immediately, because the final response can only be built once
  // the user id is known -- building it earlier and reconstructing it after
  // would drop these.
  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          pendingCookies.push(...cookiesToSet);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  // Never trust a client-supplied value for this header -- start from the
  // incoming headers, strip whatever's there, then set it ourselves only
  // once getUser() has actually verified the session.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(USER_ID_HEADER);
  if (data.user) requestHeaders.set(USER_ID_HEADER, data.user.id);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));

  return response;
}

export const config = {
  matcher: [
    // api/cron is excluded: those routes authenticate with their own bearer
    // secret (no cookie session to refresh), so routing them through here
    // just added a wasted Supabase auth round-trip to every scheduled run.
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
