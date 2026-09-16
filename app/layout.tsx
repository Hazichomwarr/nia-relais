import type { Metadata } from "next";
import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { ConnectivityIndicator } from "@/components/pwa/connectivity-indicator";
import { getLocale } from "@/src/i18n/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NIA — Small steps. Brighter tomorrows.",
  description: "A peaceful place to keep promises to yourself.",
  applicationName: "NIA",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/nia-512.png",
    apple: "/icons/nia-apple-touch-180.png",
  },
  appleWebApp: {
    capable: true,
    title: "NIA",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#255b48",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-[100dvh] flex-col">
        <ServiceWorkerRegistration />
        <ConnectivityIndicator offlineLabel={locale === "en" ? "You're offline" : "Vous êtes hors ligne"} />
        {children}
      </body>
    </html>
  );
}
