import { PageBackLink } from "@/components/navigation/page-back-link";
import { requireSuperAdmin } from "@/src/auth/require-super-admin";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function AdminPage() {
  await requireSuperAdmin();
  const dictionary = getDictionary(await getLocale());

  return (
    <main className="min-h-[calc(100dvh-73px)] bg-[var(--nia-app-background)] px-5 py-8 text-[var(--nia-text)] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <PageBackLink href="/dashboard" label={dictionary.common.dashboard} />
        <section className="mt-4 rounded-[1.75rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-6 shadow-sm sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">{dictionary.admin.eyebrow}</p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">{dictionary.admin.title}</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--nia-text-muted)]">{dictionary.admin.description}</p>
        </section>
      </div>
    </main>
  );
}
