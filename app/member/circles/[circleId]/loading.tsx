export default function MemberDashboardLoading() {
  return (
    <main className="min-h-screen bg-[#fbf7ef] px-5 py-10 text-[#173b32] sm:px-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto w-full max-w-3xl animate-pulse space-y-6">
        <p className="text-sm font-medium text-[#587066]">Loading your circle…</p>
        <div className="h-12 w-3/5 rounded-xl bg-[#eadfce]" />
        <div className="h-56 rounded-[1.75rem] bg-[#f0e7da]" />
      </div>
    </main>
  );
}
