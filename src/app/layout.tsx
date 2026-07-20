import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { NavBar } from "@/components/nav-bar";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <NavBar />
          <KeyboardShortcuts />
          <AnalyticsTracker />
          <TourOverlay />
          <PageTransition>{children}</PageTransition>
        </ThemeProvider>
      </body>
    </html>
  );
}
