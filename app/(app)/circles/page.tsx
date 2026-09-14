import type { Metadata } from "next";

import { requireUser } from "@/src/auth/require-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";
import { getCirclesForOwnerIndex } from "@/src/services/circle-owner-index.service";

import { CircleIndex } from "./circle-index";

export const metadata: Metadata = {
  title: "My SUSU circles · NIA",
};

export default async function CirclesPage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const circles = await getCirclesForOwnerIndex(user.id);

  return <CircleIndex circles={circles} dictionary={getDictionary(locale)} locale={locale} />;
}
