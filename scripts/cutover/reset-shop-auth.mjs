import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { MongoClient } from "mongodb";

import {
  DATABASE_NAME,
  databaseName,
  fingerprint,
  normalizeShop,
  readEnvironment,
} from "./token-exchange-common.mjs";

const DEFAULT_ENV = ".env";
const DEFAULT_BACKUP_DIRECTORY = "scripts/cutover/backups";

function parseArguments(arguments_) {
  const options = {
    env: DEFAULT_ENV,
    execute: false,
    outputDirectory: DEFAULT_BACKUP_DIRECTORY,
    shop: null,
  };
  for (const argument of arguments_) {
    if (argument.startsWith("--env=")) {
      options.env = argument.slice("--env=".length);
    } else if (argument.startsWith("--shop=")) {
      options.shop = argument.slice("--shop=".length);
    } else if (argument.startsWith("--output-directory=")) {
      options.outputDirectory = argument.slice(
        "--output-directory=".length,
      );
    } else if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage:
  npm run reset:shop-auth -- --shop=SHOP
  npm run reset:shop-auth -- --shop=SHOP --execute

The default mode is read-only. Execution clears only Store authentication
fields and matching shopify_sessions records. It never deletes the Store or
its Configuration, XmlLink, FeedRefreshSchedule, or StoreSubscription.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return {
    ...options,
    env: resolve(options.env),
    outputDirectory: resolve(options.outputDirectory),
    shop: normalizeShop(options.shop),
  };
}

function hashSessionId(value) {
  return typeof value === "string"
    ? createHash("sha256").update(value).digest("hex").slice(0, 16)
    : null;
}

function isoDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : null;
}

function timestampForFilename(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function sessionFilter(shop) {
  return {
    $or: [
      { shop },
      { _id: `offline_${shop}` },
      { id: `offline_${shop}` },
    ],
  };
}

async function relatedCounts(database, storeId) {
  const filter = { storeId };
  const [
    configurations,
    feedRefreshSchedules,
    storeSubscriptions,
    xmlLinks,
  ] = await Promise.all([
    database.collection("Configuration").countDocuments(filter),
    database.collection("FeedRefreshSchedule").countDocuments(filter),
    database.collection("StoreSubscription").countDocuments(filter),
    database.collection("XmlLink").countDocuments(filter),
  ]);
  return {
    configurations,
    feedRefreshSchedules,
    storeSubscriptions,
    xmlLinks,
  };
}

async function readState(database, shop) {
  const store = await database.collection("Store").findOne(
    { shopDomain: shop },
    {
      projection: {
        _id: 1,
        accessStatus: 1,
        accessToken: 1,
        accessTokenExpiresAt: 1,
        refreshToken: 1,
        refreshTokenExpiresAt: 1,
        shopDomain: 1,
        status: 1,
        tokenRefreshLockId: 1,
        tokenRefreshLockedAt: 1,
        updatedAt: 1,
      },
    },
  );
  if (!store) throw new Error(`Store ${shop} was not found.`);

  const sessions = await database
    .collection("shopify_sessions")
    .find(sessionFilter(shop), {
      projection: {
        _id: 1,
        expires: 1,
        id: 1,
        isOnline: 1,
        refreshTokenExpires: 1,
        shop: 1,
      },
    })
    .toArray();

  return {
    raw: { sessions, store },
    safe: {
      accessStatus: store.accessStatus ?? null,
      accessTokenExpiresAt: isoDate(store.accessTokenExpiresAt),
      accessTokenFingerprint: fingerprint(store.accessToken),
      hasAccessToken: Boolean(store.accessToken),
      hasRefreshLock: Boolean(
        store.tokenRefreshLockId || store.tokenRefreshLockedAt,
      ),
      hasRefreshToken: Boolean(store.refreshToken),
      refreshTokenExpiresAt: isoDate(store.refreshTokenExpiresAt),
      refreshTokenFingerprint: fingerprint(store.refreshToken),
      related: await relatedCounts(database, store._id),
      sessions: sessions.map((session) => ({
        expiresAt: isoDate(session.expires),
        idFingerprint: hashSessionId(session.id ?? session._id),
        isOnline: session.isOnline ?? null,
        refreshTokenExpiresAt: isoDate(session.refreshTokenExpires),
      })),
      shopDomain: store.shopDomain,
      status: store.status ?? null,
      storeId: store._id.toHexString(),
      updatedAt: isoDate(store.updatedAt),
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.shop) {
    throw new Error("--shop must be a valid myshopify.com domain.");
  }
  const environment = await readEnvironment(options.env);
  if (databaseName(environment.DATABASE_URL) !== DATABASE_NAME) {
    throw new Error(
      `DATABASE_URL must target the ${DATABASE_NAME} database.`,
    );
  }

  const client = new MongoClient(environment.DATABASE_URL);
  await client.connect();
  try {
    const database = client.db(DATABASE_NAME);
    const before = await readState(database, options.shop);
    const backup = {
      createdAt: new Date().toISOString(),
      database: DATABASE_NAME,
      note:
        "Token values are intentionally omitted; only fingerprints and metadata are stored.",
      state: before.safe,
    };
    const backupPath = resolve(
      options.outputDirectory,
      `${options.shop}-auth-${timestampForFilename()}.json`,
    );
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(
      backupPath,
      `${JSON.stringify(backup, null, 2)}\n`,
      "utf8",
    );

    if (!options.execute) {
      console.log(
        JSON.stringify(
          {
            backup: backupPath,
            execute: false,
            planned: {
              sessionsToDelete: before.safe.sessions.length,
              storeAuthenticationFieldsToClear: [
                "accessToken",
                "accessTokenExpiresAt",
                "refreshToken",
                "refreshTokenExpiresAt",
                "tokenRefreshLockId",
                "tokenRefreshLockedAt",
              ],
            },
            state: before.safe,
          },
          null,
          2,
        ),
      );
      return;
    }

    const transaction = client.startSession();
    let sessionsDeleted = 0;
    try {
      await transaction.withTransaction(async () => {
        const sessionResult = await database
          .collection("shopify_sessions")
          .deleteMany(sessionFilter(options.shop), {
            session: transaction,
          });
        sessionsDeleted = sessionResult.deletedCount;

        const store = before.raw.store;
        const storeResult = await database.collection("Store").updateOne(
          {
            _id: store._id,
            accessToken: store.accessToken ?? null,
            refreshToken: store.refreshToken ?? null,
          },
          {
            $set: {
              accessToken: null,
              accessTokenExpiresAt: null,
              refreshToken: null,
              refreshTokenExpiresAt: null,
              tokenRefreshLockId: null,
              tokenRefreshLockedAt: null,
              updatedAt: new Date(),
            },
          },
          { session: transaction },
        );
        if (storeResult.matchedCount !== 1) {
          throw new Error(
            "The Store authentication fields changed after preview; no reset was applied.",
          );
        }
      });
    } finally {
      await transaction.endSession();
    }

    const after = await readState(database, options.shop);
    if (
      after.safe.hasAccessToken ||
      after.safe.hasRefreshToken ||
      after.safe.hasRefreshLock ||
      after.safe.sessions.length !== 0
    ) {
      throw new Error("Authentication reset verification failed.");
    }
    if (
      JSON.stringify(after.safe.related) !==
      JSON.stringify(before.safe.related)
    ) {
      throw new Error("A related collection count changed unexpectedly.");
    }

    console.log(
      JSON.stringify(
        {
          backup: backupPath,
          execute: true,
          preserved: after.safe.related,
          sessionsDeleted,
          shopDomain: options.shop,
          statusPreserved: after.safe.status,
          verified: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
