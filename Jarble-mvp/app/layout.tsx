import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-playfair",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${playfair.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
