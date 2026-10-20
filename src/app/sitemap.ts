import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// /sitemap.xml, for Google Search Console (2026-10-20): the public pages
// worth finding in search. Privacy, Terms, Cookies and Contact are left out
// on purpose -- those pages ask not to be indexed (robots: index false).
// Everything behind sign-in is useless to a search engine, so it isn't here.
const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
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
