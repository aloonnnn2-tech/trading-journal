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
          {/* First thing in the tab order, invisible until focused. Every page
              in the app starts with the same nav bar, so without this a
              keyboard or screen-reader user tabs through the whole navigation
              again on every single page before reaching the content they came
              for. `sr-only` hides it visually; `focus:not-sr-only` brings it
              back the moment it is focused, which is the whole trick. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:text-zinc-950"
          >
            Skip to main content
          </a>
          <NavBar isAdmin={admin} />
          <KeyboardShortcuts />
          <AnalyticsTracker />
          <TourOverlay />
          {/* The app's pages had no <main> at all -- only the three legal pages
              did -- so assistive tech had no "main landmark" to jump to and the
              skip link above would have had nothing to point at. tabIndex={-1}
              makes it a valid target for that link without putting it in the
              tab order itself. */}
          <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
            <PageTransition>{children}</PageTransition>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
