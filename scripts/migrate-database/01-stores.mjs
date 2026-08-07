import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient } from "mongodb";

import {
  SOURCE_ACCESS_COLLECTION,
  SOURCE_INSTALLER_COLLECTION,
  SOURCE_STORE_COLLECTION,
  STORE_FIELDS_DEFERRED,
  STORE_FIELDS_MIGRATED,
  TARGET_STORE_COLLECTION,
  normalizeShopDomain,
  transformLegacyStore,
} from "./store-transform.mjs";

const DEFAULT_OUTPUT_DIRECTORY = "scripts/migrate-database/.migration-output";

function printUsage() {
  console.log(`
Store migration (gsf -> target database)

Dry run (default):
  npm run migrate:stores -- --dry-run

Migrate one shop:
  npm run migrate:stores -- --execute --confirm-target=Multi-sync --shop=example.myshopify.com

Options:
  --dry-run                 Read both databases and write only a local report.
  --execute                 Insert missing target Store documents.
  --confirm-target=NAME     Required with --execute; must exactly match TARGET_DATABASE_NAME.
  --shop=DOMAIN             Process only one normalized myshopify.com domain.
  --limit=N                 Process at most N source stores.
  --include-access-tokens   Copy legacy access tokens for installed stores.
  --prepare=PATH            Save one shop as an editable approval file.
  --prepare-all=PATH        Save all missing shops as one approval file.
  --output=PATH             Write the JSON report to PATH.
  --help                    Show this help.

Safety:
  - gsf is read-only in this script.
  - Existing target Store documents are never updated or deleted.
  - Source MongoDB _id values are not copied.
`);
}

export function parseArguments(argv) {
  const options = {
    confirmTarget: null,
    execute: false,
    help: false,
    includeAccessTokens: false,
    limit: null,
    output: null,
    prepare: null,
    prepareAll: null,
    shop: null,
  };

  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.execute = false;
    } else if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--include-access-tokens") {
      options.includeAccessTokens = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--confirm-target=")) {
      options.confirmTarget = argument.slice("--confirm-target=".length);
    } else if (argument.startsWith("--shop=")) {
      options.shop = normalizeShopDomain(argument.slice("--shop=".length));
    } else if (argument.startsWith("--limit=")) {
      const value = Number(argument.slice("--limit=".length));
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      options.limit = value;
    } else if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
    } else if (argument.startsWith("--prepare=")) {
      options.prepare = argument.slice("--prepare=".length);
    } else if (argument.startsWith("--prepare-all=")) {
      options.prepareAll = argument.slice("--prepare-all=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function requiredEnvironment(values, name) {
  const value = values[name]?.trim();
  if (!value) {
    throw new Error(`${name} or DATABASE_URL is required`);
  }
  return value;
}

export function validateEnvironment(options, values = process.env) {
  const sharedDatabaseUri = values.DATABASE_URL?.trim();
  const environment = {
    sourceDatabaseName: values.SOURCE_DATABASE_NAME?.trim() || "gsf",
    sourceUri:
      values.SOURCE_MONGODB_URI?.trim() ||
      requiredEnvironment({ DATABASE_URL: sharedDatabaseUri }, "DATABASE_URL"),
    targetDatabaseName: values.TARGET_DATABASE_NAME?.trim() || "Multi-sync",
    targetUri:
      values.TARGET_MONGODB_URI?.trim() ||
      requiredEnvironment({ DATABASE_URL: sharedDatabaseUri }, "DATABASE_URL"),
  };

  if (environment.sourceDatabaseName !== "gsf") {
    throw new Error(
      `SOURCE_DATABASE_NAME must be exactly "gsf"; received "${environment.sourceDatabaseName}"`,
    );
  }
  if (
    environment.sourceDatabaseName.toLowerCase() ===
    environment.targetDatabaseName.toLowerCase()
  ) {
    throw new Error("Source and target database names must be different");
  }
  if (
    options.execute &&
    options.confirmTarget !== environment.targetDatabaseName
  ) {
    throw new Error(
      `Execution requires --confirm-target=${environment.targetDatabaseName}`,
    );
  }
  if (options.prepare && !options.shop) {
    throw new Error("--prepare requires --shop=DOMAIN");
  }
  if (options.prepare && options.execute) {
    throw new Error("--prepare cannot be combined with --execute");
  }
  if (options.prepare && options.includeAccessTokens) {
    throw new Error(
      "--prepare cannot include access tokens; tokens are handled separately",
    );
  }
  if (options.prepareAll && options.execute) {
    throw new Error("--prepare-all cannot be combined with --execute");
  }
  if (options.prepareAll && options.prepare) {
    throw new Error("--prepare-all cannot be combined with --prepare");
  }

  return environment;
}

function indexDocumentsByShop(documents, fieldName) {
  const index = new Map();

  for (const document of documents) {
    const shop = normalizeShopDomain(document[fieldName]);
    if (!shop) continue;

    const matches = index.get(shop) ?? [];
    matches.push(document);
    index.set(shop, matches);
  }

  return index;
}

async function hasUniqueShopDomainIndex(collection) {
  const indexes = await collection.indexes();
  return indexes.some(
    (index) =>
      index.unique === true &&
      Object.keys(index.key).length === 1 &&
      index.key.shopDomain === 1,
  );
}

function serializeReport(report) {
  return JSON.stringify(
    report,
    (_key, value) => (value instanceof Date ? value.toISOString() : value),
    2,
  );
}

function makeOutputPath(options, startedAt) {
  if (options.output) return resolve(options.output);

  const timestamp = startedAt.toISOString().replaceAll(/[:.]/g, "-");
  return resolve(
    DEFAULT_OUTPUT_DIRECTORY,
    `stores-${options.execute ? "execute" : "dry-run"}-${timestamp}.json`,
  );
}

export async function migrateStores({ environment, options }) {
  const startedAt = new Date();
  const sourceClient = new MongoClient(environment.sourceUri, {
    readPreference: "secondaryPreferred",
  });
  const targetClient = new MongoClient(environment.targetUri);

  const report = {
    migration: "Store",
    mode: options.execute ? "execute" : "dry-run",
    startedAt,
    source: {
      database: environment.sourceDatabaseName,
      collections: [
        SOURCE_STORE_COLLECTION,
        SOURCE_INSTALLER_COLLECTION,
        SOURCE_ACCESS_COLLECTION,
      ],
      writes: 0,
    },
    target: {
      database: environment.targetDatabaseName,
      collection: TARGET_STORE_COLLECTION,
      uniqueShopDomainIndex: null,
      inserts: 0,
      updates: 0,
      deletes: 0,
    },
    options: {
      includeAccessTokens: options.includeAccessTokens,
      limit: options.limit,
      shop: options.shop,
    },
    fieldPolicy: {
      migrated: STORE_FIELDS_MIGRATED,
      deferredToLaterModels: STORE_FIELDS_DEFERRED,
    },
    summary: {
      sourceSelected: 0,
      valid: 0,
      wouldInsert: 0,
      inserted: 0,
      existingSkipped: 0,
      invalid: 0,
      warnings: 0,
    },
    stores: [],
  };

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);

    const sourceDb = sourceClient.db(environment.sourceDatabaseName);
    const targetDb = targetClient.db(environment.targetDatabaseName);
    const sourceStores = sourceDb.collection(SOURCE_STORE_COLLECTION);
    const targetStores = targetDb.collection(TARGET_STORE_COLLECTION);

    const [installerDocuments, accessDocuments] = await Promise.all([
      sourceDb
        .collection(SOURCE_INSTALLER_COLLECTION)
        .find(
          {},
          {
            projection: {
              shop: 1,
              installed: 1,
              firstInstallAt: 1,
              lastInstallAt: 1,
              lastUninstallAt: 1,
            },
          },
        )
        .toArray(),
      sourceDb
        .collection(SOURCE_ACCESS_COLLECTION)
        .find(
          {},
          {
            projection: {
              shop: 1,
              suspended: 1,
              updatedAt: 1,
            },
          },
        )
        .toArray(),
    ]);

    const installersByShop = indexDocumentsByShop(installerDocuments, "shop");
    const accessByShop = indexDocumentsByShop(accessDocuments, "shop");
    const legacyStoreDocuments = await sourceStores
      .find(
        {},
        {
          projection: {
            _id: 1,
            shopDomain: 1,
            accessToken: 1,
          },
        },
      )
      .sort({ shopDomain: 1, _id: 1 })
      .toArray();
    const legacyStoresByShop = new Map(
      legacyStoreDocuments.map((store) => [
        normalizeShopDomain(store.shopDomain),
        store,
      ]),
    );
    const stores = [...legacyStoreDocuments];

    for (const installer of installerDocuments) {
      const shopDomain = normalizeShopDomain(installer.shop);
      if (!shopDomain || legacyStoresByShop.has(shopDomain)) continue;

      stores.push({
        _id: installer._id,
        shopDomain,
        accessToken: null,
        sourceCollection: SOURCE_INSTALLER_COLLECTION,
      });
    }

    stores.sort((left, right) =>
      normalizeShopDomain(left.shopDomain).localeCompare(
        normalizeShopDomain(right.shopDomain),
      ),
    );

    let selectedStores = stores;
    if (options.shop) {
      selectedStores = selectedStores.filter(
        (store) => normalizeShopDomain(store.shopDomain) === options.shop,
      );
    }
    if (options.limit) selectedStores = selectedStores.slice(0, options.limit);
    report.summary.sourceSelected = selectedStores.length;

    report.target.uniqueShopDomainIndex =
      await hasUniqueShopDomainIndex(targetStores);
    if (options.execute && !report.target.uniqueShopDomainIndex) {
      throw new Error(
        "Target Store must have a unique { shopDomain: 1 } index before execution",
      );
    }

    for (const sourceStore of selectedStores) {
      const shopDomain = normalizeShopDomain(sourceStore.shopDomain);
      const installerMatches = installersByShop.get(shopDomain) ?? [];
      const accessMatches = accessByShop.get(shopDomain) ?? [];
      const record = {
        sourceId: String(sourceStore._id),
        sourceCollection:
          sourceStore.sourceCollection ?? SOURCE_STORE_COLLECTION,
        targetId: null,
        shopDomain,
        action: null,
        tokenCopied: false,
        proposedDocument: null,
        warnings: [],
        error: null,
      };

      try {
        if (installerMatches.length > 1) {
          throw new Error(
            `Found ${installerMatches.length} InstallerShop documents`,
          );
        }
        if (accessMatches.length > 1) {
          throw new Error(`Found ${accessMatches.length} ShopAccess documents`);
        }

        const transformed = transformLegacyStore({
          includeAccessTokens: options.includeAccessTokens,
          installerShop: installerMatches[0],
          migrationTime: startedAt,
          shopAccess: accessMatches[0],
          store: sourceStore,
        });
        if (sourceStore.sourceCollection === SOURCE_INSTALLER_COLLECTION) {
          transformed.warnings.unshift(
            "No legacy Store document; created from InstallerShop lifecycle history",
          );
        }
        record.warnings.push(...transformed.warnings);
        record.tokenCopied = Boolean(transformed.document.accessToken);
        record.proposedDocument = {
          ...transformed.document,
          accessToken: null,
        };
        report.summary.valid += 1;
        report.summary.warnings += record.warnings.length;

        const existing = await targetStores.findOne(
          { shopDomain },
          { projection: { _id: 1 } },
        );
        if (existing) {
          record.targetId = String(existing._id);
          record.action = "existing-skipped";
          report.summary.existingSkipped += 1;
          report.stores.push(record);
          continue;
        }

        if (!options.execute) {
          record.action = "would-insert";
          report.summary.wouldInsert += 1;
          report.stores.push(record);
          continue;
        }

        const result = await targetStores.updateOne(
          { shopDomain },
          { $setOnInsert: transformed.document },
          { upsert: true },
        );
        const target = await targetStores.findOne(
          { shopDomain },
          { projection: { _id: 1 } },
        );
        record.targetId = target ? String(target._id) : null;

        if (result.upsertedCount === 1) {
          record.action = "inserted";
          report.summary.inserted += 1;
          report.target.inserts += 1;
        } else {
          record.action = "existing-skipped";
          report.summary.existingSkipped += 1;
        }
      } catch (error) {
        record.action = "invalid";
        record.error = error instanceof Error ? error.message : String(error);
        report.summary.invalid += 1;
      }

      report.stores.push(record);
    }

    report.completedAt = new Date();
    return report;
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const environment = validateEnvironment(options);
  console.log(
    `[Store migration] mode=${options.execute ? "EXECUTE" : "DRY RUN"} source=${environment.sourceDatabaseName} target=${environment.targetDatabaseName}`,
  );
  console.log(
    `[Store migration] access tokens=${options.includeAccessTokens ? "INCLUDED" : "NOT COPIED"}`,
  );

  const report = await migrateStores({ environment, options });
  const outputPath = makeOutputPath(options, new Date(report.startedAt));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serializeReport(report)}\n`, "utf8");

  if (options.prepare) {
    const record = report.stores[0];
    if (
      report.stores.length !== 1 ||
      !record ||
      record.action === "invalid" ||
      !record.proposedDocument
    ) {
      throw new Error(
        "An approval file requires exactly one valid source store",
      );
    }

    const candidatePath = resolve(options.prepare);
    const candidate = {
      formatVersion: 1,
      generatedAt: new Date(),
      sourceDatabase: environment.sourceDatabaseName,
      sourceId: record.sourceId,
      sourceCollection: record.sourceCollection,
      sourceShopDomain: record.shopDomain,
      targetDatabase: environment.targetDatabaseName,
      document: record.proposedDocument,
    };
    await mkdir(dirname(candidatePath), { recursive: true });
    await writeFile(candidatePath, `${serializeReport(candidate)}\n`, "utf8");
    console.log(`Editable candidate: ${candidatePath}`);
  }

  if (options.prepareAll) {
    const candidatePath = resolve(options.prepareAll);
    const missingStores = report.stores.filter(
      (record) => record.action === "would-insert" && record.proposedDocument,
    );
    const candidates = {
      formatVersion: 1,
      candidateType: "StoreBulk",
      generatedAt: new Date(),
      sourceDatabase: environment.sourceDatabaseName,
      targetDatabase: environment.targetDatabaseName,
      summary: {
        candidates: missingStores.length,
        installed: missingStores.filter(
          (record) => record.proposedDocument.status === "INSTALLED",
        ).length,
        uninstalled: missingStores.filter(
          (record) => record.proposedDocument.status === "UNINSTALLED",
        ).length,
        existingSkipped: report.summary.existingSkipped,
        warnings: missingStores.reduce(
          (total, record) => total + record.warnings.length,
          0,
        ),
      },
      stores: missingStores.map((record) => ({
        sourceId: record.sourceId,
        sourceCollection: record.sourceCollection,
        sourceShopDomain: record.shopDomain,
        accessTokenAvailable: record.tokenCopied,
        warnings: record.warnings,
        document: record.proposedDocument,
      })),
    };
    await mkdir(dirname(candidatePath), { recursive: true });
    await writeFile(candidatePath, `${serializeReport(candidates)}\n`, "utf8");
    console.log(`Editable bulk candidate: ${candidatePath}`);
  }

  console.log(JSON.stringify(report.summary, null, 2));
  console.log(
    `Source writes=${report.source.writes}; target inserts=${report.target.inserts}; target updates=${report.target.updates}; target deletes=${report.target.deletes}`,
  );
  console.log(`Report: ${outputPath}`);

  if (report.summary.invalid > 0) {
    process.exitCode = 2;
  }
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(
      `[Store migration] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
