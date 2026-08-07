import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { BSON, MongoClient } from "mongodb";

const DATABASE_NAME = "Multi-sync";
const APPROVED_SHOPS = Object.freeze([
  "adon-test-1.myshopify.com",
  "teststore2pierre.myshopify.com",
]);

const execute = process.argv.includes("--execute");
const confirmDatabase = readArgument("--confirm-database");
const confirmShops = readArgument("--confirm-shops")
  ?.split(",")
  .map((shop) => shop.trim().toLowerCase())
  .filter(Boolean);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

assertMongoUrl(process.env.DATABASE_URL);
assertDatabaseInUrl(process.env.DATABASE_URL, DATABASE_NAME);

if (!execute) {
  throw new Error(
    "This script only runs with --execute. It always creates a local Extended JSON backup before deleting.",
  );
}

if (confirmDatabase !== DATABASE_NAME) {
  throw new Error(`Pass --confirm-database=${DATABASE_NAME}.`);
}

if (
  !confirmShops ||
  confirmShops.length !== APPROVED_SHOPS.length ||
  !APPROVED_SHOPS.every((shop) => confirmShops.includes(shop))
) {
  throw new Error(
    `Pass --confirm-shops=${APPROVED_SHOPS.join(",")} to confirm the exact hard-coded scope.`,
  );
}

const client = new MongoClient(process.env.DATABASE_URL);

try {
  await client.connect();
  const db = client.db(DATABASE_NAME);
  await db.command({ ping: 1 });

  const inventory = await buildInventory(db);
  assertSafeInventory(inventory);

  const backupPath = await saveBackup(inventory);
  console.log(`Backup created: ${backupPath}`);
  printCounts("Documents approved for deletion", inventory.documents);

  const deletedCounts = {};
  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      const currentStores = await db
        .collection("Store")
        .find(
          { _id: { $in: idsOf(inventory.documents.Store) } },
          { session },
        )
        .toArray();

      assertStoresRemainSafe(currentStores);

      for (const collectionName of deletionOrder()) {
        const ids = idsOf(inventory.documents[collectionName]);
        if (ids.length === 0) {
          deletedCounts[collectionName] = 0;
          continue;
        }

        const result = await db
          .collection(collectionName)
          .deleteMany({ _id: { $in: ids } }, { session });

        if (result.deletedCount !== ids.length) {
          throw new Error(
            `${collectionName}: expected to delete ${ids.length} documents, deleted ${result.deletedCount}. Transaction aborted.`,
          );
        }

        deletedCounts[collectionName] = result.deletedCount;
      }
    });
  } finally {
    await session.endSession();
  }

  printCounts("Deleted documents", deletedCounts);

  const remaining = await findRemainingReferences(db, inventory);
  const remainingCount = Object.values(remaining).reduce(
    (sum, count) => sum + count,
    0,
  );

  if (remainingCount !== 0) {
    printCounts("Remaining references", remaining);
    throw new Error(
      `Deletion committed, but verification found ${remainingCount} new or remaining references. Review them before rerunning.`,
    );
  }

  const storeSummary = await db
    .collection("Store")
    .aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log("Verification passed: no database references remain.");
  console.log(
    `Store collection after deletion: ${JSON.stringify(
      Object.fromEntries(storeSummary.map(({ _id, count }) => [_id, count])),
    )}`,
  );
} finally {
  await client.close();
}

async function buildInventory(db) {
  const stores = await db
    .collection("Store")
    .find({ shopDomain: { $in: APPROVED_SHOPS } })
    .toArray();
  const storeIds = idsOf(stores);

  const [jobs, runs] = await Promise.all([
    db
      .collection("AttributeRuleJob")
      .find({ storeId: { $in: storeIds } })
      .toArray(),
    db
      .collection("FeedRefreshRun")
      .find({ storeId: { $in: storeIds } })
      .toArray(),
  ]);

  const documents = {
    Store: stores,
    Configuration: await findByStoreId(db, "Configuration", storeIds),
    StoreSubscription: await findByStoreId(
      db,
      "StoreSubscription",
      storeIds,
    ),
    XmlLink: await findByStoreId(db, "XmlLink", storeIds),
    AttributeRuleJob: jobs,
    AttributeRuleMatch: await db
      .collection("AttributeRuleMatch")
      .find({ jobId: { $in: idsOf(jobs) } })
      .toArray(),
    FeedRefreshSchedule: await findByStoreId(
      db,
      "FeedRefreshSchedule",
      storeIds,
    ),
    FeedRefreshRun: runs,
    FeedRefreshRunItem: await db
      .collection("FeedRefreshRunItem")
      .find({ runId: { $in: idsOf(runs) } })
      .toArray(),
    DiagnosticsSnapshot: await findByShop(
      db,
      "DiagnosticsSnapshot",
      APPROVED_SHOPS,
    ),
    DiagnosticsSnapshotProduct: await findByShop(
      db,
      "DiagnosticsSnapshotProduct",
      APPROVED_SHOPS,
    ),
    shopify_sessions: await findByShop(
      db,
      "shopify_sessions",
      APPROVED_SHOPS,
    ),
  };

  return {
    database: DATABASE_NAME,
    shops: [...APPROVED_SHOPS],
    generatedAt: new Date(),
    documents,
  };
}

function assertSafeInventory(inventory) {
  const stores = inventory.documents.Store;

  if (stores.length !== APPROVED_SHOPS.length) {
    throw new Error(
      `Expected exactly ${APPROVED_SHOPS.length} Store documents, found ${stores.length}. Nothing was deleted.`,
    );
  }

  assertStoresRemainSafe(stores);
}

function assertStoresRemainSafe(stores) {
  const actualShops = stores.map(({ shopDomain }) => shopDomain).sort();
  const expectedShops = [...APPROVED_SHOPS].sort();

  if (JSON.stringify(actualShops) !== JSON.stringify(expectedShops)) {
    throw new Error(
      `Store identity changed during the operation. Nothing was deleted.`,
    );
  }

  const installed = stores.filter(({ status }) => status !== "UNINSTALLED");
  if (installed.length > 0) {
    throw new Error(
      `Refusing to delete because these stores are not UNINSTALLED: ${installed
        .map(({ shopDomain, status }) => `${shopDomain} (${status})`)
        .join(", ")}`,
    );
  }
}

async function saveBackup(inventory) {
  const outputDirectory = path.resolve(
    "scripts",
    "migrate-database",
    ".migration-output",
  );
  await mkdir(outputDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(
    outputDirectory,
    `delete-shops-backup-${timestamp}.json`,
  );
  await writeFile(
    backupPath,
    `${BSON.EJSON.stringify(inventory, null, 2, { relaxed: false })}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  return backupPath;
}

async function findRemainingReferences(db, inventory) {
  const storeIds = idsOf(inventory.documents.Store);
  const jobIds = idsOf(inventory.documents.AttributeRuleJob);
  const runIds = idsOf(inventory.documents.FeedRefreshRun);

  return {
    Store: await countByIdsOrFilter(
      db,
      "Store",
      idsOf(inventory.documents.Store),
      { shopDomain: { $in: APPROVED_SHOPS } },
    ),
    Configuration: await countByIdsOrFilter(
      db,
      "Configuration",
      idsOf(inventory.documents.Configuration),
      { storeId: { $in: storeIds } },
    ),
    StoreSubscription: await countByIdsOrFilter(
      db,
      "StoreSubscription",
      idsOf(inventory.documents.StoreSubscription),
      { storeId: { $in: storeIds } },
    ),
    XmlLink: await countByIdsOrFilter(
      db,
      "XmlLink",
      idsOf(inventory.documents.XmlLink),
      { storeId: { $in: storeIds } },
    ),
    AttributeRuleJob: await countByIdsOrFilter(
      db,
      "AttributeRuleJob",
      jobIds,
      { storeId: { $in: storeIds } },
    ),
    AttributeRuleMatch: await countByIdsOrFilter(
      db,
      "AttributeRuleMatch",
      idsOf(inventory.documents.AttributeRuleMatch),
      { jobId: { $in: jobIds } },
    ),
    FeedRefreshSchedule: await countByIdsOrFilter(
      db,
      "FeedRefreshSchedule",
      idsOf(inventory.documents.FeedRefreshSchedule),
      { storeId: { $in: storeIds } },
    ),
    FeedRefreshRun: await countByIdsOrFilter(
      db,
      "FeedRefreshRun",
      runIds,
      { storeId: { $in: storeIds } },
    ),
    FeedRefreshRunItem: await countByIdsOrFilter(
      db,
      "FeedRefreshRunItem",
      idsOf(inventory.documents.FeedRefreshRunItem),
      { runId: { $in: runIds } },
    ),
    DiagnosticsSnapshot: await countByIdsOrFilter(
      db,
      "DiagnosticsSnapshot",
      idsOf(inventory.documents.DiagnosticsSnapshot),
      { shop: { $in: APPROVED_SHOPS } },
    ),
    DiagnosticsSnapshotProduct: await countByIdsOrFilter(
      db,
      "DiagnosticsSnapshotProduct",
      idsOf(inventory.documents.DiagnosticsSnapshotProduct),
      { shop: { $in: APPROVED_SHOPS } },
    ),
    shopify_sessions: await countByIdsOrFilter(
      db,
      "shopify_sessions",
      idsOf(inventory.documents.shopify_sessions),
      { shop: { $in: APPROVED_SHOPS } },
    ),
  };
}

async function countByIdsOrFilter(db, collectionName, ids, filter) {
  const clauses = [filter];
  if (ids.length > 0) clauses.push({ _id: { $in: ids } });
  return db
    .collection(collectionName)
    .countDocuments(clauses.length === 1 ? clauses[0] : { $or: clauses });
}

function deletionOrder() {
  return [
    "FeedRefreshRunItem",
    "FeedRefreshRun",
    "FeedRefreshSchedule",
    "AttributeRuleMatch",
    "AttributeRuleJob",
    "DiagnosticsSnapshotProduct",
    "DiagnosticsSnapshot",
    "XmlLink",
    "Configuration",
    "StoreSubscription",
    "shopify_sessions",
    "Store",
  ];
}

function findByStoreId(db, collectionName, storeIds) {
  return db
    .collection(collectionName)
    .find({ storeId: { $in: storeIds } })
    .toArray();
}

function findByShop(db, collectionName, shops) {
  return db
    .collection(collectionName)
    .find({ shop: { $in: shops } })
    .toArray();
}

function idsOf(documents) {
  return documents.map(({ _id }) => _id);
}

function printCounts(title, documentsOrCounts) {
  const counts = Object.fromEntries(
    Object.entries(documentsOrCounts).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.length : value,
    ]),
  );
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`${title}: ${total} total`);
  for (const [name, count] of Object.entries(counts)) {
    if (count > 0) console.log(`  ${name}: ${count}`);
  }
}

function readArgument(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function assertMongoUrl(databaseUrl) {
  if (
    !databaseUrl.startsWith("mongodb://") &&
    !databaseUrl.startsWith("mongodb+srv://")
  ) {
    throw new Error("DATABASE_URL must be a MongoDB connection string.");
  }
}

function assertDatabaseInUrl(databaseUrl, expectedDatabase) {
  const withoutQuery = databaseUrl.split("?", 1)[0];
  const encodedDatabase = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  const actualDatabase = decodeURIComponent(encodedDatabase);

  if (actualDatabase !== expectedDatabase) {
    throw new Error(
      `DATABASE_URL targets "${actualDatabase || "(none)"}", not "${expectedDatabase}".`,
    );
  }
}
