import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function CircleWorkspaceLoading() {
  const dictionary = getDictionary(await getLocale());
  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-10" aria-busy="true" aria-live="polite">
      <div className="mx-auto grid w-full max-w-6xl animate-pulse gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="h-44 rounded-[1.75rem] bg-[#f0e7da]" />
        <div className="space-y-5">
          <p className="text-sm font-medium text-[#587066]">{dictionary.susuOwner.loadingCircle}</p>
          <div className="h-12 w-2/5 rounded-xl bg-[#eadfce]" />
          <div className="h-64 rounded-[1.75rem] bg-[#f0e7da]" />
        </div>
      </div>
    </main>
  );
}
