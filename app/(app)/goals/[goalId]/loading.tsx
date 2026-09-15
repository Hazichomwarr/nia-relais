import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function GoalLoading() {
  const dictionary = getDictionary(await getLocale());
  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-12" aria-busy="true" aria-live="polite">
      <div className="mx-auto w-full max-w-2xl animate-pulse space-y-6">
        <p className="text-sm font-medium text-[#587066]">{dictionary.personalSavings.loadingSavingsRecord}</p>
        <div className="h-10 w-3/5 rounded-xl bg-[#eadfce]" />
        <div className="h-40 rounded-[1.75rem] bg-[#f0e7da]" />
      </div>
    </main>
  );
}
