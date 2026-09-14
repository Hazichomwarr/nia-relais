# NIA English/French localization

NIA supports `en` (English) and `fr` (Français). The default locale is French (`fr`).

## Resolution and persistence

The canonical resolver is `getLocale()` in `src/i18n/locale.ts`. It accepts only values in `SUPPORTED_LOCALES`; an absent, malformed, or unsupported `nia_locale` cookie safely resolves to French.

`nia_locale` is a one-year, path-wide, same-site preference cookie. It is not authentication or authorization state and it is not stored in the database. The shared language switcher writes this cookie and refreshes the current route, including its query string.

## Dictionaries

`src/i18n/dictionaries/en.ts` and `fr.ts` must both satisfy the shared `Dictionary` shape. English and French copy is addressed through typed dictionary objects, not raw string keys in JSX. Add the semantic key to `types.ts`, then implement it in both dictionaries before using it.

## Translation rules

- Translate product interface meaning naturally; do not translate NIA, RELAIS, or SUSU.
- **USER DATA IS NEVER TRANSLATED.** Goal names, circle names, member names, notes, and generated credentials remain exactly as persisted.
- **DOMAIN ENUM VALUES ARE NEVER LOCALIZED IN PERSISTENCE.** Presentation maps may label persisted values differently, but `ACTIVE`, `PENDING`, and all other stored values are unchanged.
- Keep services and domain errors language-neutral. Localize safe messages only at UI presentation boundaries.

## Dates, money, frequency, and status

Use the shared `formatDate` helper with UTC semantics for date-only values. It renders English dates with `en-US` and French dates with `fr-FR` without changing stored dates.

Money remains in the existing V1 currency-code-first display convention in this foundation ticket. Amount values and Decimal arithmetic are untouched. Frequency and status dictionaries are available for future screen migrations; do not create page-local translations.

## Migration scope

This foundation migrates landing, platform login, registration, SUSU member login, and the shared authenticated header. Dashboard, Personal Savings, SUSU workspaces, member workspace, and Trusted Person body content remain intentionally untranslated until their dedicated migrations.

The landing image `public/images/nia-hero.png` is shared across locales and was not changed. If it contains embedded English text, that remains a known asset-level limitation for a future image-specific ticket.
