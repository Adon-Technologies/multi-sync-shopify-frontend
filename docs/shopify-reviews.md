# Shopify App Store review clicks

Clicking any of the five stars opens `https://apps.shopify.com/multi-sync-google-feed` in a new tab. Multi Sync no longer calls the App Bridge Reviews API or opens an in-app review form. The clicked star value is neither sent to Shopify nor stored as a rating.

The banner checks `GET /app/review-click` before rendering. It appears on Dashboard, Feeds, Diagnostics, Configurations, Support and Plan. A click immediately hides it in the shared store-scoped query cache and posts to `/app/review-click`. The saved Feedback event suppresses the banner across all six pages, including after a reload and for other users of that store. A failed save retries once, then restores a retryable banner. No review submission/publication is inferred from a click.

## Feedback documents

The existing MongoDB `Feedback` collection is reused. Its old private feedback documents and existing indexes are preserved; old ratings/messages alone do not count as App Store clicks. All three Prisma schemas contain the same Feedback model.

New documents use `eventType: APP_STORE_REVIEW_CLICK` and store:

- `storeId`: Multi Sync Store ObjectId; `shopifyStoreId`: Shopify Shop GID.
- `shopifyUserId`: the actual clicker's Shopify user ID, from the validated session token.
- `userId`: an existing dashboard User ObjectId, if a verified email matches one; otherwise null. Clicking never creates a dashboard login. This keeps the existing field compatible with historic documents.
- `userName`, `email`, `emailVerified`, `accountOwner`, `collaborator`: details of the clicker, when provided by Shopify.
- `storeName`, `shopDomain`, `storeDomain`, `storeEmail`, `storeContactEmail`: store metadata and separate owner/public contact emails.
- `appStoreUrl`, `clickedAt`, `createdAt`, `updatedAt`, and deterministic `submissionId`.

New documents leave `rating` and `message` empty. The existing unique `(storeId, submissionId)` index makes repeat clicks/retries from the same Shopify user idempotent. Distinct users retain distinct records if they click before the banner's persisted dismissal is loaded.

The authenticated POST ignores all client identity, shop, email and rating fields. A matching online session supplies the clicker's identity directly. For offline sessions, a one-time online token exchange provides `associated_user` without requiring `read_users` or changing global authentication. Returned tokens are discarded and never stored in Feedback. The verified user ID and store ID/domain remain available if enrichment fails; unavailable names/emails remain null, rather than using the store owner as the clicker.

The existing authenticated SHOP_REDACT flow deletes these new click events for the matching uninstall marker. It skips reinstalls and never deletes historic private Feedback records or dashboard users.

## Implementation

- `app/components/ReviewBanner.tsx`: external navigation, immediate dismissal and retry notice.
- `app/components/DashboardTabs.tsx`: authenticated shop scope for all banner placements.
- `app/services/shopify-reviews.ts`: store-scoped status query and click POST.
- `app/routes/app.review-click.tsx`: authenticated, uncached GET/POST.
- `app/services/review-click.server.ts`: identity enrichment, snapshots, deduplication and redaction.
- Frontend/backend/dashboard `prisma/schema.prisma`: compatible Feedback models/indexes.

## Verification

Focused tests exercise all five stars, keyboard/hover behavior, immediate external navigation, dismissal/remount/reload, tenant separation, failed saves, authenticated identity, forged payloads, offline/online enrichment, duplicate races, compatibility and redaction.

Frontend typecheck, build and lint on changed files pass. Backend/dashboard typechecks and all three Prisma schema validations pass. Full frontend lint reports two existing unused `_query` parameters in unrelated dashboard statistics/store-information tests.

Normal frontend/backend Prisma generation encountered locked Windows engine DLLs. Temporary client generation completed successfully, confirmed byte-identical engines, and synchronized the installed schema metadata without stopping running apps. Dashboard generation completed normally.

Production checks were read-only: verified the Feedback collection's existing unique index and document field types. No deployment, database migration, historic-data rewrite or production click was performed.

## Shopify references

- [Navigation API](https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/navigation-api): opening external pages outside the embedded app.
- [Access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens): online token exchange and `associated_user`.
- [Shop fields, API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Shop): store name, domains and contact emails.
