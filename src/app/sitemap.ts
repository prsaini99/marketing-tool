import type { MetadataRoute } from "next";

/**
 * Sitemap for the public marketing pages ONLY. The app (/dashboard, /login)
 * is deliberately absent. An auth-walled dashboard in a sitemap invites
 * crawlers to index redirect noise, and robots.ts disallows it anyway.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://adsboys.com";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/instagram-dm-automation`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/manychat-alternative`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/instagram-lead-generation`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/facebook-page-automation`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/comment-to-dm`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/for-agencies`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/data-deletion`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
