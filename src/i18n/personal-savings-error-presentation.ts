import type { Dictionary } from "./dictionaries/types";

export function localizePersonalSavingsError(message: string, dictionary: Dictionary) {
  const errors = dictionary.personalSavingsErrors;
  if (/not available for deposits/i.test(message)) return errors.unavailable;
  if (/create.*goal|goal.*required|target amount|weekly amount|start date|currency/i.test(message)) return errors.createFailed;
  if (/complete/i.test(message)) return errors.completeFailed;
  if (/archive|pending deposits/i.test(message)) return errors.archiveFailed;
  if (/deposit|record/i.test(message)) return errors.saveFailed;
  return errors.invalidInput;
}
