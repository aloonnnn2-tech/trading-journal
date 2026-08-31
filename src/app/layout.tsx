import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { NavBar } from "@/components/nav-bar";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { PageTransition } from "@/components/page-transition";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { TourOverlay } from "@/components/tour/tour-overlay";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trading Lens",
  description: "Review, analyze, and improve your trading performance.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Drives the Admin link in the nav, which is the only signal anywhere in
  // the app that an account has admin rights -- /admin/analytics is
  // deliberately unlinked, so without this there's no way to tell except by
  // typing the URL and seeing whether it redirects.
  //
  // getUserIdFromHeader rather than requireUserId: this runs for logged-out
  // visitors on the marketing pages too, and must not redirect them. The
  // lookup is a single indexed column read, skipped entirely when there's no
  // session, and isAdmin() fails closed on any error.
  const userId = await getUserIdFromHeader();
  // Set per-request by src/proxy.ts alongside the CSP that names it.
  // next-themes writes an inline <script> into the document to apply the
  // stored theme before first paint -- without the nonce that script is a
  // CSP violation, and once the policy is enforced rather than report-only
  // it would be blocked outright, bringing back the white flash on every
  // load for anyone using dark mode.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const admin = userId ? await isAdmin(await createClient(), userId) : false;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} nonce={nonce}>
          <NavBar isAdmin={admin} />
          <KeyboardShortcuts />
          <AnalyticsTracker />
          <TourOverlay />
          <PageTransition>{children}</PageTransition>
        </ThemeProvider>
      </body>
    </html>
  );
}
