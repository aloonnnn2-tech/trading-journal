import type { MetadataRoute } from "next";
import { FREE_TOOL_PATHS } from "@/lib/free-tools";
import { SITE_URL } from "@/lib/site";

// /sitemap.xml, for Google Search Console (2026-10-20): the public pages
// worth finding in search. Privacy, Terms, Cookies and Contact are left out
// on purpose -- those pages ask not to be indexed (robots: index false).
// Everything behind sign-in is useless to a search engine, so it isn't here.
const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  // The free tools are here to be found, so they rank just under the homepage.
  ...FREE_TOOL_PATHS.map((path) => ({ path, priority: 0.8 })),
  { path: "/paid-plan", priority: 0.7 },
  { path: "/sign-up", priority: 0.6 },
  { path: "/help", priority: 0.5 },
  { path: "/sign-in", priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
