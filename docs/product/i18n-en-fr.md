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

## Covered surfaces

The EN/FR presentation layer covers public/auth routes, the authenticated platform shell and dashboard, Personal Savings, Trusted Person workflows, owner SUSU workspaces, and membership-scoped SUSU login/workspaces. Localization is presentation-only: it does not change authentication, authorization, financial calculations, lifecycle rules, persisted schema, or migration state.

Canonical terminology includes: Dashboard / Tableau de bord; My savings / Mon épargne; Goal / Objectif; Savings / Épargne; Trusted person / Personne de confiance; Contribution / Cotisation; Payout / Versement; Recipient / Bénéficiaire; Round / Tour; Payout order / Ordre des versements; Circle ID / Identifiant du cercle; Member Code / Code membre; PIN / Code PIN.

The landing image `public/images/nia-hero.png` is shared across locales and was not changed. If it contains embedded English text, that remains a known asset-level limitation for a future image-specific ticket.
