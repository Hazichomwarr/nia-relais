import "server-only";

import { cookies } from "next/headers";

import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return resolveLocale(value);
}
