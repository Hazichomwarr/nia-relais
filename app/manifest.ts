import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NIA — Épargne & SUSU",
    short_name: "NIA",
    description: "A calm shared ledger for savings accountability and SUSU coordination.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2f7f3",
    theme_color: "#255b48",
    icons: [
      { src: "/icons/nia-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/nia-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/nia-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
