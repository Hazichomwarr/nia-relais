import "server-only";

import { en } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import type { Dictionary } from "./dictionaries/types";
import type { Locale } from "./config";

const dictionaries: Record<Locale, Dictionary> = { en, fr };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
