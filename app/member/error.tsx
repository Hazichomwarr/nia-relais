"use client";

import { RecoveryPanel } from "@/app/recovery-panel";
import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
import { LOCALE_COOKIE } from "@/src/i18n/config";

export default function MemberError({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  const locale = typeof document !== "undefined" && new RegExp(`(?:^|; )${LOCALE_COOKIE}=en(?:;|$)`).test(document.cookie) ? "en" : "fr";
  const dictionary = locale === "en" ? en : fr;
  const copy = dictionary.memberWorkspace;
  return (
    <RecoveryPanel
      heading={copy.memberErrorHeading}
      description={copy.memberErrorDescription}
      retry={unstable_retry}
      retryLabel={dictionary.common.retry}
      returnHref="/member/login"
      returnLabel={copy.returnToSignIn}
    />
  );
}
