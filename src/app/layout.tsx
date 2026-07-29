import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import Script from "next/script";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-editorial",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GEXLab V3 — Market context, clearly mapped",
  description:
    "A calm, beginner-friendly market regime and options-structure briefing for NQ and ES.",
};

const themeScript = `
  (function () {
    try {
      var stored = localStorage.getItem("gexlab-v3:theme");
      document.documentElement.dataset.theme = stored === "dark" ? "dark" : "light";
    } catch (error) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${newsreader.variable} ${plexMono.variable}`}
    >
      <body>
        <Script id="gexlab-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
