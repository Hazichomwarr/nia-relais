"use client";

import { useEffect, useState } from "react";

export function ConnectivityIndicator({
  offlineLabel,
  restoredLabel,
}: Readonly<{ offlineLabel: string; restoredLabel: string }>) {
  const [status, setStatus] = useState<"online" | "offline" | "restored">(() =>
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online",
  );

  useEffect(() => {
    const goOffline = () => setStatus("offline");
    const goOnline = () => setStatus((current) => (current === "offline" ? "restored" : "online"));
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  useEffect(() => {
    if (status !== "restored") return;
    const timeout = window.setTimeout(() => setStatus("online"), 3000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  if (status === "online") return null;
  return <div role="status" aria-live="polite" className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 rounded-xl bg-[#255b48] px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">{status === "offline" ? offlineLabel : restoredLabel}</div>;
}
