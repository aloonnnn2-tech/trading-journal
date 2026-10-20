import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// /robots.txt (2026-10-20): points search engines at the sitemap, and keeps
// them out of what isn't for search -- the API, the admin pages, and
// /home-v2, a side-by-side draft of the homepage that would otherwise be
// indexed as a duplicate of "/". Not a security control: every one of these
// is protected on its own; this only stops crawlers wasting time there.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/", "/home-v2"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
