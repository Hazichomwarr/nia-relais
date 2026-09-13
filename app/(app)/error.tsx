"use client";

import { RecoveryPanel } from "@/app/recovery-panel";

export default function AuthenticatedAppError({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  return (
    <RecoveryPanel
      heading="We couldn’t load this page."
      description="Please try again. If it keeps happening, return to your dashboard and try once more later."
      retry={unstable_retry}
      returnHref="/dashboard"
      returnLabel="Return to dashboard"
    />
  );
}
