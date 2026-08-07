# Multi Sync Google Feed cutover

This directory prepares the current Multi-Sync codebase to run under the
existing **Multi Sync Google Feed** Shopify app identity while keeping:

- MongoDB database: `Multi-sync`
- GCS bucket: `multi-sync`
- backend service:
  `https://multi-sync-server-392904571480.europe-west1.run.app`
- frontend service: `https://multi-sync.fly.dev`

No script in the preview/audit path deploys code, publishes Shopify
configuration, writes to GCS, or changes MongoDB.

## Files

- `../../shopify.app.multi-sync-google-feed.toml`: isolated Shopify production
  configuration for the existing app. Keeping it separate prevents an
  accidental command against the current default app configuration.
- `audit-readiness.mjs`: read-only filesystem, MongoDB, and optional Shopify
  Admin API validation. The report never contains credentials.
- `prepare-token-exchange.mjs`: builds a local approval candidate after
  read-only validation. It stores only shop domains, Store IDs, and token
  fingerprints.
- `apply-token-exchange.mjs`: guarded one-shop or bulk token exchange. A
  successful exchange is irreversible and revokes the old non-expiring token.

Generated `*.report.json` and `*.candidate.json` files are gitignored.

## Required production environment

Use the existing Multi Sync Google Feed values for these variables in both
services:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`

Use these backend values:

- `SHOPIFY_APP_HANDLE=multi-sync-google-feed`
- `SHOPIFY_APP_ID=<the existing app's Partner App ID>`
- `SHOPIFY_PARTNER_ORG_ID=<organization ID>`
- `SHOPIFY_PARTNER_ACCESS_TOKEN=<Manage apps Partner token>`
- `SHOPIFY_API_VERSION=2026-07`
- `SHOPIFY_PARTNER_API_VERSION=2026-07`
- `SHOPIFY_LEGACY_BILLING_FALLBACK=true`
- `SHOPIFY_PAID_PLAN_HANDLE=pro-plan`

Preserve these infrastructure values:

- both `DATABASE_URL` values end in `/Multi-sync`
- `GCS_BUCKET_NAME=multi-sync`
- frontend `MULTI_SYNC_BACKEND_URL` is the `multi-sync-server` Cloud Run URL
- backend `PUBLIC_FEED_BASE_URL=https://feed.multi-sync.com/store`
- the same strong `MULTI_SYNC_INTERNAL_SECRET` is set in both services

Use `.env.example` in each project as the complete non-secret template.

## Read-only checks

From `multi-sync-frontend`:

```powershell
npm run audit:cutover
npm run audit:cutover:shopify
npm run prepare:token-exchange
```

The Shopify version makes only read-only Admin API calls. The token preview
does not exchange anything.

Run the audit again after setting the old app credentials locally. Credential
fingerprints, the app handle, database, bucket, backend URL, live tokens,
scopes, subscriptions, XML links, sessions, and schedules must be reviewed
before a deployment.

## Safe production order

Do not exchange a production token while the old runtime is still responsible
for that shop. The old non-expiring token is revoked immediately.

1. Take MongoDB and deployment snapshots. Do not copy or rename `Session`;
   `shopify_sessions` is owned by Shopify's session adapter.
2. Pause the Cloud Scheduler dispatcher. Do not delete its job.
3. Configure the backend with the existing app credentials and verify the
   deployed backend contains token refresh, billing fallback, and the current
   `Multi-sync`/`multi-sync` targets.
4. Configure the frontend with the same app credentials and internal secret.
5. Deploy the frontend code to `multi-sync.fly.dev`.
6. Only after both services are healthy, deploy the isolated Shopify config:

   ```powershell
   shopify app deploy --config multi-sync-google-feed
   ```

   Review the CLI summary interactively. Do not use an unattended deletion
   flag.
7. Open one development shop through the existing app and verify embedded
   authentication, Store token persistence, billing, feed reads, and webhook
   HMAC handling.
8. Exchange exactly one eligible non-production token as a canary. First run
   validation without `--execute`:

   ```powershell
   npm run exchange:token -- --file=scripts/cutover/token-exchange.candidate.json --confirm-hash=<approved-hash> --shop=<canary.myshopify.com>
   ```

   Then add `--execute` only after reviewing the validation result.
9. Wait past the access-token refresh window and confirm the backend rotated
   and persisted both tokens, then generate/refresh the canary XML.
10. Exchange remaining eligible tokens in controlled batches. Bulk mode is
    intentionally protected by an additional environment confirmation.
11. Rerun `npm run audit:cutover:shopify`. Resume Cloud Scheduler only when
    valid paid/trial stores have working tokens, subscriptions, XML links, and
    schedules.
12. Keep the old deployment available but do not let it process cron jobs or
    write tokens after the Shopify app URL points to the new frontend.

## Stores that cannot be token-exchanged

Missing or rejected tokens are not fixed by token exchange. Those merchants
must open the existing app and complete Shopify authentication again. A store
can be marked `UNINSTALLED` only with independent evidence that the app is no
longer installed; a missing token alone isn't proof.

Stores without a current `TRIAL` or `ACTIVE` `StoreSubscription` intentionally
fail the billing gate, so their scheduled refresh is not queued.

## Session behavior

Do not migrate the legacy Prisma `Session` collection into
`shopify_sessions`. The current session adapter creates or replaces the
offline session when a merchant opens the app. Background XML refresh uses the
token fields on `Store`, not a manually copied session document.
