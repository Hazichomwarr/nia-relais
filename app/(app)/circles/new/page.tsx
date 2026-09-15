import type { Metadata } from "next";

import { NewCircleForm } from "./new-circle-form";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const dictionary = getDictionary(await getLocale());
  return { title: `${dictionary.susu.createCircle} · NIA` };
}

// Protected by app/(app)/layout.tsx's requireUser() -- same as every other
// page under this route group (e.g. /goals/new). No separate owner
// authentication system is introduced here.
export default async function NewCirclePage() {
  const locale = await getLocale();
  return <NewCircleForm dictionary={getDictionary(locale)} locale={locale} />;
}
