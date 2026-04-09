import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display, Press_Start_2P, Caveat, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Theme-specific fonts: preload disabled so they are only fetched when the
// corresponding theme is active (pixel, handdrawn, elegant). Saves ~100-150KB
// on initial load for users on the default theme.
const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-playfair",
  preload: false,
});

const pressStart2P = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-pixel",
  preload: false,
});

const caveat = Caveat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-handdrawn",
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f9" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Jarble",
    template: "%s | Jarble",
  },
  description: "Deploy powerful AI bots across WhatsApp, Discord, Slack, and more. No coding required.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Jarble",
    description: "Deploy powerful AI bots across WhatsApp, Discord, Slack, and more. No coding required.",
    type: "website",
    url: "https://jarble.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "Jarble",
    description: "Deploy powerful AI bots across WhatsApp, Discord, Slack, and more. No coding required.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${playfair.variable} ${pressStart2P.variable} ${caveat.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
