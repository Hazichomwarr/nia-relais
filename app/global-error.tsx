"use client";

import "./globals.css";

import { RecoveryPanel } from "@/app/recovery-panel";
import { LOCALE_COOKIE } from "@/src/i18n/config";
import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

export default function GlobalError({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  const locale = typeof document !== "undefined" && new RegExp(`(?:^|; )${LOCALE_COOKIE}=en(?:;|$)`).test(document.cookie) ? "en" : "fr";
  const dictionary = locale === "en" ? en : fr;
  return (
    <html lang={locale}>
      <body className="min-h-full bg-[#fbf7ef] antialiased">
        <RecoveryPanel
          heading={dictionary.common.globalErrorTitle}
          description={dictionary.common.globalErrorDescription}
          retry={unstable_retry}
          retryLabel={dictionary.common.retry}
          returnHref="/"
          returnLabel={dictionary.common.returnHome}
        />
      </body>
    </html>
  );
}
