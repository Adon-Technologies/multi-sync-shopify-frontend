# Database migration

These scripts migrate one model at a time from the legacy `gsf` MongoDB
database. The source database is never modified by these scripts.

## Store migration safety

`01-stores.mjs`:

- defaults to dry-run mode;
- only calls read methods against `gsf`;
- inserts missing target stores by normalized `shopDomain`;
- never updates or deletes an existing target Store;
- never copies a legacy MongoDB `_id`;
- never logs access-token values;
- copies access tokens only with `--include-access-tokens`;
- writes a local source-to-target Store ID report for later child migrations.

For stronger protection, give `SOURCE_MONGODB_URI` a MongoDB user that has only
the `read` role on `gsf`. Code-level safeguards are useful, but database
permissions are the strongest guarantee.

## Quick start

The normal command uses the existing `.env` `DATABASE_URL`. It reads `gsf` and
targets `Multi-sync` on the same MongoDB cluster.

Test the field transformation:

```powershell
npm run test:migrate:stores
```

Preview every Store:

```powershell
npm run migrate:stores -- --dry-run
```

Preview one Store:

```powershell
npm run migrate:stores -- --dry-run --shop=example.myshopify.com
```

Create an editable preview for one Store:

```powershell
npm run migrate:stores -- --shop=example.myshopify.com --prepare=scripts/migrate-database/store.candidate.json
```

Open `store.candidate.json`, inspect or edit the permitted values, and then
insert exactly that approved Store:

```powershell
npm run migrate:store:approved -- --execute --confirm-target=Multi-sync --file=scripts/migrate-database/store.candidate.json
```

The approved-file command connects only to the target database. It does not
connect to `gsf`, and it refuses access tokens, unknown fields, a changed shop
domain, or an existing target Store.

Create one editable JSON containing every missing Store:

```powershell
npm run migrate:stores -- --dry-run --include-access-tokens --prepare-all=scripts/migrate-database/remaining-stores.candidate.json
```

The JSON excludes domains already present in the target. Access-token values
are never written to the file; `accessTokenAvailable` only records whether a
source token can be copied securely after approval.

After reviewing or removing entries from the bulk candidate, insert exactly the
approved entries and securely copy available installed-store tokens:

```powershell
npm run migrate:store:approved -- --execute --confirm-target=Multi-sync --copy-access-tokens --file=scripts/migrate-database/remaining-stores.candidate.json
```

This command validates the complete file before writing, skips domains that
already exist, reads tokens from `gsf` without modifying it, and never logs
token values.

Create an editable reconciliation for Shopify's Current Merchants CSV:

```powershell
npm run migrate:stores:shopify-csv -- --file="C:\path\current-merchants.csv" --output=scripts/migrate-database/shopify-csv-store-reconciliation.candidate.json
```

The preview reads `Multi-sync.Store` and performs no database writes or
deletes. It proposes every CSV shop as `INSTALLED`, adds `shopPlan`, preserves
existing token values without writing them into the JSON, reactivates matching
`UNINSTALLED` documents, inserts missing shops with a null token, and leaves
stores outside the CSV unchanged.

After approving the complete before/after file, apply it transactionally:

```powershell
npm run migrate:stores:shopify-csv:approved -- --execute --confirm-target=Multi-sync --file=scripts/migrate-database/shopify-csv-store-reconciliation.candidate.json
```

The approved command aborts if any reviewed Store changed after preview
generation. It never deletes a Store and never changes an existing access
token.

Insert one missing Store without its access token:

```powershell
npm run migrate:stores -- --execute --confirm-target=Multi-sync-migration-test --shop=example.myshopify.com
```

Include a legacy access token only after confirming that `gsf` and Multi-sync
use the same Shopify app/API credentials:

```powershell
npm run migrate:stores -- --execute --confirm-target=Multi-sync-migration-test --shop=example.myshopify.com --include-access-tokens
```

The confirmation value must exactly match `TARGET_DATABASE_NAME`.

For separate source and target credentials, copy `migration.env.example` to
`migration.env`, fill it in, and invoke the Node script with that environment
file directly.

## Store field policy

The Store migration copies or derives only:

- `shopDomain`
- `accessToken` (opt-in)
- `status` from `InstallerShop.installed`
- `accessStatus` from `ShopAccess.suspended`
- `installedAt`, `uninstalledAt`, `createdAt`, and `updatedAt`

Legacy configuration and scheduling fields are intentionally not inserted into
the target Store. They will be handled by later Configuration and
FeedRefreshSchedule migrations. Feed collections and `shopify_sessions` are not
touched by this migration.
