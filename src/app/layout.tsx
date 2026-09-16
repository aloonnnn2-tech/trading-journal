import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Geist_Mono, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
// Design V2's entire stylesheet. Imported after globals.css and deliberately
// outside any Tailwind @layer, so its rules outrank the utility classes they
// override. Every selector in it is scoped under html[data-design="v2"], so
// with the flag off this file contributes nothing at all.
// The whole of Design V2: the original design with the machine-made tells
// removed. Every rule is scoped under
// html[data-design="v2"]:has([data-v2-refined]), so with the flag off the
// file contributes nothing at all.
import "@/styles/design-v2-refined.css";
import { ThemeProvider } from "@/components/theme-provider";
import { NavBar } from "@/components/nav-bar";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { PageTransition } from "@/components/page-transition";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { TourOverlay } from "@/components/tour/tour-overlay";
import { DesignFlagScript } from "@/components/design/design-flag";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Design V2's faces. They are loaded unconditionally, and that is unavoidable:
// the flag lives in localStorage, which the server cannot read, so there is no
// point at which we could know to load them and still have them in the document
// before first paint.
//
// Loading them is inert for V1. Nothing outside src/styles/design-v2.css
// mentions --font-plex-sans or --font-plex-mono, so with the flag off these
// only add two class names on <html> and two <style> blocks; not one rendered
// pixel changes. Along with the flag <script>, this is one of exactly two
// accepted differences between this branch's V1 and the default branch --
// see DESIGN_V2_PLAN.md section 6.
//
// Plex Sans is loaded variable so V2 can use the 550 weight its type scale
// calls for. Plex Mono ships only fixed weights, hence the explicit pair.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
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
  // lookup is skipped entirely when there's no session, and shares the page's
  // own settings read when there is one (see getUserSettings).
  const userId = await getUserIdFromHeader();
  // Set per-request by src/proxy.ts alongside the CSP that names it.
  // next-themes writes an inline <script> into the document to apply the
  // stored theme before first paint -- without the nonce that script is a
  // CSP violation, and once the policy is enforced rather than report-only
  // it would be blocked outright, bringing back the white flash on every
  // load for anyone using dark mode.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Read from the same cached settings row every page fetches anyway, so
  // this costs nothing on top of the page's own load. Fails closed: any
  // error means no Admin link, which is the same posture isAdmin() takes.
  const settings = userId
    ? await getUserSettings(await createClient(), userId).catch(() => null)
    : null;
  const admin = settings?.is_admin ?? false;
  const paid = settings ? isPaidUser(settings) : false;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Design V2's flag, applied before first paint so a V2 session never
            flashes V1 chrome. See src/components/design/design-flag.tsx --
            with the flag off this writes no attribute at all. */}
        <DesignFlagScript nonce={nonce} />
      </head>
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
          <NavBar isAdmin={admin} isPaid={paid} />
          <KeyboardShortcuts />
          <AnalyticsTracker />
          <TourOverlay />
          {/* The app's pages had no <main> at all -- only the three legal pages
              did -- so assistive tech had no "main landmark" to jump to and the
              skip link above would have had nothing to point at. tabIndex={-1}
              makes it a valid target for that link without putting it in the
              tab order itself. */}
          {/* data-v2-refined here rather than on each page: the design now
              covers the whole app, and :has() on <html> only needs to find it
              once. Rules specific to one kind of page are scoped by
              data-v2-page instead, so the marketing hero's type scale and the
              login card's chrome cannot leak into the app screens. */}
          <main
            id="main-content"
            tabIndex={-1}
            data-v2-refined
            className="flex flex-1 flex-col"
          >
            <PageTransition>{children}</PageTransition>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
