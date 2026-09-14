"use server";

import { cookies } from "next/headers";

import { isLocale, LOCALE_COOKIE, type Locale } from "@/src/i18n/config";

export async function setLocaleAction(locale: Locale) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { httpOnly: false, maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
}
