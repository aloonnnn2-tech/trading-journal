import { headers } from "next/headers";
import { redirect } from "next/navigation";

// The middleware (src/proxy.ts) already runs `getUser()` once per request
// and forwards the verified id via this header -- reading it here avoids a
// second real network round-trip to Supabase Auth on every page/route.
// Trustworthy because the middleware strips any client-supplied value
// before setting its own; a client cannot forge it.
const USER_ID_HEADER = "x-user-id";

/** Server Components: redirects to /sign-in if the middleware saw no session. */
export async function requireUserId(): Promise<string> {
  const id = (await headers()).get(USER_ID_HEADER);
  if (!id) redirect("/sign-in");
  return id;
}

/** API routes: returns null instead of redirecting, so the caller can 401. */
export async function getUserIdFromHeader(): Promise<string | null> {
  return (await headers()).get(USER_ID_HEADER);
}
