import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Type system — three voices, each with a job:
 *
 *   Hanken Grotesk       body/UI. High x-height grotesque that stays crisp at
 *                        13px table density — reads nothing like the Geist
 *                        it replaces.
 *   Bricolage Grotesque  display. Page titles, KPI numbers, the brand. Its
 *                        tight apertures and slightly odd proportions are
 *                        what make the app look designed rather than themed.
 *   IBM Plex Mono        data. Metrics, ids, currency — inherently tabular,
 *                        so numeric columns never jitter.
 *
 * All three load via next/font (self-hosted, zero layout shift, no external
 * requests at runtime).
 */
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "adsboys: Meta Ads Command",
  description: "adsboys, the agency command deck for Meta ad accounts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${bricolage.variable} ${plexMono.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
