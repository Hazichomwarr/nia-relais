"use client";

import "./globals.css";

import { RecoveryPanel } from "@/app/recovery-panel";

export default function GlobalError({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  return (
    <html lang="en">
      <body className="min-h-full bg-[#fbf7ef] antialiased">
        <RecoveryPanel
          heading="Something went wrong."
          description="Please try again. If the problem continues, return home and try again later."
          retry={unstable_retry}
          returnHref="/"
          returnLabel="Return home"
        />
      </body>
    </html>
  );
}
