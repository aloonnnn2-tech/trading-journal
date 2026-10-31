// Marketing-adjacent pages with no logged-in-only content -- app-only UI
// (nav bar, keyboard shortcuts) shouldn't activate on these for logged-out
// visitors.
export const PUBLIC_PATHS = [
  "/",
  "/home-v2",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/auth/confirm",
  "/privacy",
  "/terms",
  "/cookies",
  "/contact",
  // Help must work for someone who can't sign in.
  "/help",
  "/paid-plan",
  // Free tools, found through search. Signed-in visitors see them too.
  "/position-size-calculator",
  "/how-to-journal-a-swing-trade",
];
