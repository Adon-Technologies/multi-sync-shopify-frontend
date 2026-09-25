# Title attribute exclusions

Implemented in Configuration → Attributes and Exclusions. Enter adds a word or phrase to the existing draft modal; Confirm and the page Save persist it. Removable chips and the existing View action expose the saved list.

## Configuration, database and API

- Both Prisma schemas add `Configuration.excludedTitleAttributes String[] @default([])`, scoped by the existing store configuration.
- The existing `/app/configuration-data` save/load API carries the field. Server validation trims entries, ignores blanks, deduplicates case-insensitively, rejects non-string entries/non-array input, and limits input to 100 entries of 255 characters each. Text is preserved literally, including regex punctuation.
- Both existing lazy MongoDB backfills initialize only documents missing the field. The equivalent narrowly scoped backfill was applied using both projects' configured connections: both succeeded with zero documents requiring updates. A database check found zero configurations missing the field. No index change or separate collection is needed; no broad `db push` was performed.
- Prisma clients were regenerated. Windows locks prevented replacing the in-use engine DLLs, so generation used a temporary output directory and the generated client files were copied into place while retaining each project's existing engine DLL.
- The existing configuration comparison marks published store feeds `requiresRefresh: true` on additions/removals. Existing XML remains intact until regeneration. Diagnostics revisions do not include this setting.

## Feed pipeline

The worker reads current store configuration for manual and scheduled jobs. The shared generator resolves the product title for the feed/market/language, then passes it and the exclusions into the existing XML item builder. The builder assembles its existing variant-option suffix and calls the single `excludeAttributesFromTitle` helper before the existing 150-character limit, XML text sanitation and escaping.

The helper uses escaped literal alternatives, case-insensitive Unicode word boundaries, longest-phrase precedence, whitespace cleanup and original resolved-title fallback if removal leaves an empty result. Empty or missing lists preserve existing behavior exactly. Punctuation outside matched text is retained, even when removal leaves a separator. Phrase matching preserves the configured internal spacing. Existing variant-option text included in `g:title` is subject to the same transformation; stored variant titles are unchanged.

No Shopify mutations, stored product edits, description changes, diagnostic changes or changes to other XML fields were added.

## Verification

| Check | Result |
| --- | --- |
| Backend unit tests | 223 passed |
| Backend integration tests | 60 passed |
| Frontend unit tests | 172 passed; 2 existing failures |
| Frontend Vitest/UI/service tests | 59 passed across 12 files |
| TypeScript | Both projects passed |
| Lint of all modified frontend code/tests | Passed |
| Full frontend lint | 2 existing unused `_query` errors in `dashboard-product-statistics.vitest.ts` and `dashboard-store-information.vitest.ts` |
| Backend lint | No lint script configured |
| Frontend production build | Passed |
| Backend production build | `npm run build` blocked at Prisma generation by Windows DLL lock; alternate client generation succeeded, then clean, TypeScript compilation and static-asset copy all passed |

The two unchanged frontend unit failures expect the old `Market` table-header markup (`dashboard-feed-overview.test.ts`) and `Error from multi-sync` text (`diagnostics-bulk-selection.test.ts`). Their source components and tests were not changed by this feature.

New coverage includes no exclusions, case matching, complete words, phrases, repeated matches, multiple exclusions, whitespace, empty-result fallback, regex-special input, Unicode boundaries, overlapping phrases, punctuation, final variant-option titles, Primary XML, global and market-localized Additional XML, XML escaping, unchanged non-title XML, regeneration/removal, current configuration reads, manual/scheduled worker propagation, persistence/reload through the real configuration service with a mocked database, validation, refresh invalidation and UI add/duplicate/remove behavior.

Feed integration tests mock Shopify, database and upload services; no merchant feed was published and no live Shopify title was modified. Persistence/reload tests exercise the service against a mocked database, not a live app restart.

## Files changed

Frontend:

- `app/components/ConfigurationsPanel.tsx`
- `app/services/attribute-rule-schema.server.ts`
- `app/services/configuration-validation.ts`
- `app/services/configuration.server.ts`
- `packages/catalog-rules/index.js` and `index.d.ts`
- `prisma/schema.prisma`
- `tests/configuration-validation.test.ts`
- `tests/configurations-design.test.ts`
- `tests/dashboard-hydration.ui.test.tsx` (configuration fixture)
- `tests/title-attributes-validation.test.ts` (new)
- `tests/title-attributes-persistence.vitest.ts` (new)
- `tests/title-attributes-selector.ui.test.tsx` (new)
- `docs/title-attribute-exclusions.md` (this report)

Backend:

- `packages/catalog-rules/index.js` and `index.d.ts`
- `prisma/schema.prisma`
- `src/feeds/configuration.ts`
- `src/feeds/generator.ts`
- `src/feeds/xml.ts`
- `src/feeds/title.ts` (new)
- `tests/feed.test.ts`
- `tests/feed-country-worker.integration.ts`
- `tests/title-exclusions.test.ts` (new)
- `tests/title-exclusions.integration.ts` (new)
- `tests/title-configuration.integration.ts` (new)
