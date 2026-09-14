import NewGoalForm from "@/app/(app)/goals/new/new-goal-form";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function NewGoalPage() {
  const locale = await getLocale();
  return <NewGoalForm dictionary={getDictionary(locale)} locale={locale} />;
}
