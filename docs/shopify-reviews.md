# Shopify-only reviews: removal report

The Plan banner now exclusively requests Shopify's official review modal. The private Feedback feature has been removed from application source across all three services. Nothing was deployed and no database documents, collections or indexes were deleted.

## Final flow

The existing Plan panel renders `PlanReviewBanner` from `app/components/ReviewBanner.tsx`. Hover/focus fills the star prefix; pointer or keyboard activation on any star calls `requestShopifyReview()`. The unchanged helper in `app/services/shopify-reviews.ts:12` calls `shopify.reviews.request()` with no arguments on the existing App Bridge instance.

Shopify decides whether to display its native review modal. A successful response means display only, never submission or publication. The clicked star is temporary UI state; it is not passed to Shopify, persisted in browser storage, or sent to an application API. Multi Sync never reads or intercepts the real rating/message chosen inside Shopify.

All documented declines remain handled: already reviewed, cooldown, ineligible, recently installed, annual limit, mobile, cancellation, already open and opening in progress. Missing App Bridge/API, malformed responses and thrown requests remain non-fatal. The neutral fallback says the merchant can continue using Multi Sync. There is no private form, textarea, submission toast or private fallback action. Development stores use the same request path; Shopify controls preview/eligibility and publishing restrictions.

## Database and authorization

- Removed `Feedback` from all three Prisma schemas, including its three index definitions.
- Removed every `Feedback[]` relation from User/Store; User and Store themselves remain.
- Removed backend index synchronization and `db:feedback`.
- Removed merchant `POST /app/feedback-submit`, backend `/api/feedback` registration, and dashboard Feedback list/detail routes.
- Removed `/admin/feedback`, the `/feedback` redirect, desktop/mobile Feedback navigation, query keys and pagination/filter/detail code.
- RegistrationPermission model and permission-management endpoints are unchanged. The shared `registration-permission-access.ts` remains because permission management uses it. Removed only Feedback-specific aliases and the layout's Feedback permission lookup.

The old MongoDB `Feedback` collection and its indexes are intentionally untouched. The app no longer uses them, and deletion is not needed for operation. If permanent removal of historic private data is desired, an administrator should back it up as needed and manually delete that exact collection in the intended database. No `db push`, drop, deleteMany or migration against the database was run.

## Files modified

Paths below are relative to `C:/Adon Technologies/Multi-Sync-Shopify`, and describe this update only. Pre-existing tenant filter, navigation and other unrelated changes were retained.

- `multi-sync-frontend/app/components/DashboardTabs.tsx`
- `multi-sync-frontend/package.json`
- `multi-sync-frontend/prisma/schema.prisma`
- `multi-sync-frontend/vitest.config.ts`
- `multi-sync-backend/package.json`
- `multi-sync-backend/prisma/schema.prisma`
- `multi-sync-backend/src/index.ts`
- `multi-sync-backend/src/http/routes.ts`
- `multi-sync-dashboard/app/(public)/admin/layout.tsx`
- `multi-sync-dashboard/components/layout/AdminShell.tsx`
- `multi-sync-dashboard/package.json`
- `multi-sync-dashboard/package-lock.json`
- `multi-sync-dashboard/prisma/schema.prisma`

## Renamed and updated

- `multi-sync-frontend/app/components/FeedbackBanner.tsx` → `app/components/ReviewBanner.tsx`: retained Shopify review behavior; removed private mutation, modal, rating and message fields.
- `multi-sync-frontend/app/styles/feedback.module.css` → `app/styles/reviews.module.css`: preserved star styling, animation and accessibility unchanged.
- `multi-sync-frontend/tests/feedback-setup.ts` → `tests/ui-setup.ts`: retained shared UI test setup unchanged.

## Files added

- `multi-sync-frontend/tests/reviews.ui.test.tsx`
- `multi-sync-dashboard/components/layout/AdminShell.test.tsx`
- `multi-sync-frontend/docs/shopify-reviews.md` (this report)

## Files deleted

- `multi-sync-frontend/app/routes/app.feedback-submit.tsx`
- `multi-sync-frontend/app/services/feedback-identity.server.ts`
- `multi-sync-frontend/app/services/feedback-query.ts`
- `multi-sync-frontend/tests/feedback-server.vitest.ts`
- `multi-sync-frontend/tests/feedback.ui.test.tsx`
- `multi-sync-frontend/docs/feedback-feature.md`
- `multi-sync-backend/scripts/sync-feedback-schema.ts`
- `multi-sync-backend/src/feedback/domain.ts`
- `multi-sync-backend/src/feedback/schema.ts`
- `multi-sync-backend/src/feedback/service.ts`
- `multi-sync-backend/src/http/feedback-routes.ts`
- `multi-sync-backend/tests/feedback-db.test.ts`
- `multi-sync-backend/tests/feedback-schema.test.ts`
- `multi-sync-backend/tests/feedback.test.ts`
- `multi-sync-dashboard/app/(public)/admin/feedback/page.tsx`
- `multi-sync-dashboard/app/(public)/feedback/page.tsx`
- `multi-sync-dashboard/app/api/feedback/route.ts`
- `multi-sync-dashboard/app/api/feedback/[id]/route.ts`
- `multi-sync-dashboard/components/admin/feedback/FeedbackInbox.tsx`
- `multi-sync-dashboard/components/admin/feedback/FeedbackInbox.test.tsx`
- `multi-sync-dashboard/components/admin/feedback/feedback.module.css`
- `multi-sync-dashboard/lib/feedback/types.ts`
- `multi-sync-dashboard/lib/feedback/queries.ts`
- `multi-sync-dashboard/lib/server/feedback-access.ts`
- `multi-sync-dashboard/lib/server/feedback-data.ts`
- `multi-sync-dashboard/lib/server/feedback.test.ts`

Removed the dashboard's now-unused `@shopify/polaris-types` development dependency and its unused transitive dependency via npm. Frontend Polaris and the UI testing dependencies remain necessary for the retained review banner/tests.

## Verification

- Frontend: 21 Shopify review UI tests passed; full lint and TypeScript passed.
- Dashboard: 18 targeted tests passed (navigation, RegistrationPermission routes, Support and tenants); full lint and TypeScript passed.
- Backend: 15 admin/Support tests passed; TypeScript passed. There is no backend lint script configured.
- Prisma: generated and verified all three clients without a Feedback delegate/model, while retaining User/Store and dashboard RegistrationPermission.
- Windows initially locked the native query-engine DLLs during normal generation. Normal generation had already updated the client code. Completed generation to temporary output, verified its datamodel matches each installed client and its engine DLL is byte-identical, retained the locked DLLs, and completed the generated schema-copy step. No schema generator settings or application connection strings changed. A read-only MongoDB ping through the regenerated backend client succeeded.
- Searched the project for Feedback names, private endpoints and related identifiers. Remaining application uses of generic “feedback” are unrelated status messages in feed/configuration screens and the `FeedBackend` substring. The new tests intentionally assert that private UI/navigation is absent.
- Shopify's external validator cannot resolve the installed Polaris React packages. Local compiler, lint and interaction tests pass.
- Native Shopify display responses are mocked in local tests; no real App Store review was submitted.

## Visual artifacts

Updated `multi-sync-frontend/output/playwright/reviews-banner-desktop.png` and `reviews-banner-mobile.png` for the Shopify-only banner. Browser QA verified hover, keyboard activation and the missing-App-Bridge fallback; no private controls or modal appear.

Deleted these obsolete private-feature screenshots under `multi-sync-frontend/output/playwright/`:

- `feedback-banner-desktop.png`
- `feedback-banner-mobile.png`
- `feedback-detail-desktop.png`
- `feedback-detail-mobile.png`
- `feedback-inbox-desktop.png`
- `feedback-inbox-mobile.png`
- `feedback-modal-desktop.png`
- `feedback-modal-mobile.png`
- `feedback-native-desktop.png`
- `feedback-native-mobile.png`
- `reviews-private-desktop.png`
- `reviews-private-mobile.png`

Prisma clients, route types, isolated generation/preview fixtures and browser session logs are generated local artifacts rather than application source. Historical browser traces may still mention the removed interface; they are not executable feature code.

