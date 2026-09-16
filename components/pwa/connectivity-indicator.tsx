"use client";

import { useEffect, useState } from "react";

export function ConnectivityIndicator({
  offlineLabel,
}: Readonly<{ offlineLabel: string }>) {
  // navigator.onLine is a hint, not proof that NIA is unreachable. In
  // particular, iOS standalone may initially report false while requests work.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  if (!offline) return null;
  return <div role="status" aria-live="polite" className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-50 -translate-x-1/2 rounded-full bg-[#255b48] px-3 py-2 text-sm font-semibold text-white shadow-lg">● {offlineLabel}</div>;
}
