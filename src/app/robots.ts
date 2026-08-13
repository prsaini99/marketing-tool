import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The product and its APIs are not content; keep crawlers on the
        // marketing surface.
        disallow: ["/dashboard", "/api/", "/login", "/forgot-password"],
      },
    ],
    sitemap: "https://adsboys.com/sitemap.xml",
  };
}
