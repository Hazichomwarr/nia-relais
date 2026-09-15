"use client";

import { RecoveryPanel } from "@/app/recovery-panel";
import { LOCALE_COOKIE } from "@/src/i18n/config";
import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

export default function AuthenticatedAppError({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  const locale = typeof document !== "undefined" && new RegExp(`(?:^|; )${LOCALE_COOKIE}=en(?:;|$)`).test(document.cookie) ? "en" : "fr";
  const dictionary = locale === "en" ? en : fr;
  return (
    <RecoveryPanel
      heading={dictionary.common.appErrorTitle}
      description={dictionary.common.appErrorDescription}
      retry={unstable_retry}
      retryLabel={dictionary.common.retry}
      returnHref="/dashboard"
      returnLabel={dictionary.common.returnToDashboard}
    />
  );
}
