"use client";

import { RecoveryPanel } from "@/app/recovery-panel";

export default function MemberError({
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  return (
    <RecoveryPanel
      heading="We couldn’t load your circle."
      description="Please try again. If you need to sign in again, return to member sign-in."
      retry={unstable_retry}
      returnHref="/member/login"
      returnLabel="Return to member sign-in"
    />
  );
}
