# Exclude product by tag — implementation report

Implemented in the existing Attributes and Exclusions card, beside title and collection exclusions. Nothing was deployed, and no database push or live feed generation was run.

## Behavior and architecture

- **Dialog:** reuses `FeatureHeading` and `TextListSelector`, including the View action, removable chips, draft values, Confirm/Cancel and the page Save action. The shared text-list dialog binds Polaris show/hide/remove events with native listeners for React 18. The card styling was not redesigned.
- **Persistence:** `Configuration.excludedProductTags String[] @default([])` is present in the frontend, backend and dashboard Prisma schemas. Frontend validation, save, load, defaults and Diagnostics configuration mapping include it. The existing frontend/backend MongoDB backfill helpers initialize missing fields to `[]` when those services run. Saving marks published feeds as requiring refresh, using the existing configuration flow.
- **Shopify suggestions:** the authenticated `/app/configuration-data?intent=product-tags` loader calls Admin GraphQL `productTags(first: 1000, after: ...)`, collecting string nodes across cursor pages. It does not enumerate products. This is supported by the project's `2026-07` API version; the backend also defaults to `2026-07`. The query requires the existing product-read access. See [Shopify's productTags reference](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/producttags).
- **Caching and cost:** follows the existing discovery service pattern: a ten-minute per-shop cache, shared in-flight requests, bounded cached-shop count, cost-aware waits and bounded throttle retries. Failed requests are evicted. TanStack Query keys include shop/session/endpoint. Suggestions load only when the dialog opens; client-side search covers the fetched tag list and renders 50 matches initially with Show more.
- **Custom tags:** merchants may add tags regardless of suggestion availability or whether Shopify currently contains them. Surrounding whitespace is trimmed; display spelling is preserved. Duplicate detection uses the existing catalog normalization. Empty/invalid tags, values over 255 characters and lists over 100 entries are rejected by server-side validation. Suggestion loading and errors never disable manual entry.
- **Matching:** uses `normalizeCatalogText` consistently: Unicode NFKC normalization, trimmed/collapsed whitespace and case-insensitive comparison. Matching is equality against individual tag keys, never substring matching. `Sale` does not match `Wholesale`. Matching any configured tag excludes the product.
- **XML enforcement:** `multi-sync-backend/src/feeds/generator.ts`, in `generateAndUploadFeed`, obtains `product.tags` in the existing variant page query. `createProductExclusionResolver` prepares the tag lookup once per generation. The existing product-ID exclusion cache applies its decision before `buildFeedItem` and XML writing. **Every variant of a matching product is removed, including variants on later pages.** No tag-specific product/variant requests or database queries were added.
- **All feeds and triggers:** Primary and Additional feeds both call this generator with the same store configuration. Initial/manual work and manual/automatic store refresh runs converge on the existing worker `processFeed` path. Regeneration uses that same enforcement point.
- **Existing rules and counts:** collection membership and title substring matching retain their original logic; tag reasons are added to the same resolver. Existing inventory exclusion remains in item generation. The emitted `generatedItems` count excludes tagged products' variants. Catalog totals and processed-product progress retain their existing meaning.
- **Diagnostics:** existing product scans already contain tags. The shared resolver returns an `excluded-tag-*` reason such as `Excluded by tag: Clearance`; the existing `error` status places the product in the Excluded tab and its count. Nonempty tag settings participate in the Diagnostics revision, invalidating old snapshots when changed. Empty settings preserve the previous revision format.

## Verification

| Check | Result |
| --- | --- |
| Frontend `npm run lint` | Passed |
| Frontend `npm run typecheck` | Passed |
| Backend `npm run typecheck` | Passed |
| Backend `npm test` | 161 passed |
| Backend `npm run test:integration` | 2 passed; uses Node experimental module mocking, without additional dependencies |
| Frontend `npm run test:reviews` | 29 passed across 4 Vitest files |
| Frontend `npm test` | 171 passed; 1 pre-existing unrelated failure |
| Prisma validation, all three schemas | Passed |
| Dashboard `npx prisma generate` | Passed |
| Frontend/backend `npx prisma generate` | Attempted; Windows EPERM when replacing locked query engine DLLs. Client types were emitted and both typechecks pass, but full generation needs rerunning after the local processes release those DLLs. |

The unrelated failure is `tests/diagnostics-bulk-selection.test.ts:174`: it expects `Error from multi-sync`, while the existing UI uses `Error from Multi-Sync`. The mismatch also exists in Git HEAD. That test and the Diagnostics UI were not changed for this task. The backend has no lint script configured.

New tests cover normalized persistence and clearing, actual configuration service save/reload using a mocked database, Diagnostics reasons/counts, tag query pagination/cache isolation/coalescing/failure recovery/throttling, dialog loading/selection/manual input/duplicates/removal/cancel/errors/empty states/large lists, and actual Primary/Additional XML generation with mocked Shopify/database/storage boundaries. The XML integration fixture places multiple excluded variants across pages and combines title, collection and out-of-stock exclusions while checking emitted counts and request counts. Existing worker paths are also checked for shared generator routing. No live Shopify or GCS calls were used in these integration tests.

## Every source/test/report file changed for this task

Paths below are relative to their repository. Generated Prisma client files under ignored `node_modules` were also refreshed by the generation attempts.

**multi-sync-frontend**

- `app/components/ConfigurationsPanel.tsx`
- `app/routes/app.configuration-data.tsx`
- `app/services/attribute-rule-schema.server.ts`
- `app/services/configuration-query.ts`
- `app/services/configuration-revision.server.ts`
- `app/services/configuration-validation.ts`
- `app/services/configuration.server.ts`
- `app/services/diagnostics-validation.ts`
- `app/services/product-tag-discovery.server.ts` — new
- `packages/catalog-rules/index.js`
- `packages/catalog-rules/index.d.ts`
- `prisma/schema.prisma`
- `tests/configuration-validation.test.ts`
- `tests/configurations-design.test.ts`
- `tests/dashboard-hydration.ui.test.tsx` — added only `excludedProductTags: []` to the existing user-owned fixture
- `tests/product-tag-discovery.test.ts` — new
- `tests/product-tag-exclusions.test.ts` — new
- `tests/product-tag-feed.vitest.ts` — new
- `tests/product-tag-persistence.vitest.ts` — new
- `tests/product-tag-selector.ui.test.tsx` — new
- `docs/product-tag-exclusions.md` — this report

**multi-sync-backend**

- `package.json` ? adds the native Node integration-test command
- `packages/catalog-rules/index.js`
- `packages/catalog-rules/index.d.ts`
- `prisma/schema.prisma`
- `src/feeds/configuration.ts`
- `src/feeds/generator.ts`
- `tests/product-tag-exclusions.test.ts` — new

**multi-sync-dashboard**

- `prisma/schema.prisma` — keeps the shared Configuration model aligned

Pre-existing edits to `DashboardTabs.tsx`, `DiagnosticsPanel.tsx` and `useOverlayEvents.ts` were preserved without modification.
