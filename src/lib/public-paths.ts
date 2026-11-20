import { FREE_TOOL_PATHS } from "@/lib/free-tools";

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
  // The unsubscribe link in onboarding emails; opened signed out as often as not.
  "/unsubscribe",
  // Free tools, found through search. Signed-in visitors see them too.
  ...FREE_TOOL_PATHS,
];
