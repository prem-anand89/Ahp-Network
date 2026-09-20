import type { Metadata, Viewport } from "next";
import { Newsreader, Inter, IBM_Plex_Mono } from "next/font/google";
import { ROOT_METADATA } from "@/lib/site-metadata";
import "./globals.css";

// Three faces, one job each — AHP-DESIGN-SYSTEM.md's typography rules.
// Newsreader: headlines, page titles, card/profile names, avatar initials,
// the italic "Network" wordmark — never body copy, never buttons.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"], // the wordmark and avatar initials are italic;
  // without the italic face the browser synthesizes a slant, which looks
  // wrong on a serif.
});

// Inter: everything else — nav, buttons, badges, tags, labels, forms, body
// copy. Roughly 90% of all text on any given screen. Variable weight axis
// (no `weight` option) to cover the design's 400–800 range in one file.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// IBM Plex Mono: reserved for exactly one job — council registration
// numbers and record IDs. Nowhere else. Not variable on Google Fonts, so
// only the two weights the design actually uses.
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = ROOT_METADATA;

// `viewport-fit=cover` lets `env(safe-area-inset-*)` resolve to a real
// value instead of 0 on notch/home-indicator devices (iPhone X and later).
// Required for the mobile bottom tab bar and any bottom-docked sheet to
// clear the iOS home-indicator swipe area — see app-tab-bar.tsx.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
