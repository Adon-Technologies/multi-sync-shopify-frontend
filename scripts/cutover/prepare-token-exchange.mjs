import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { MongoClient } from "mongodb";

import {
  approvalHash,
  DATABASE_NAME,
  databaseName,
  fingerprint,
  normalizeShop,
  readCutoverClientId,
  readEnvironment,
  validateAdminToken,
} from "./token-exchange-common.mjs";

const DEFAULT_CONFIG = "shopify.app.toml";
const DEFAULT_ENV = ".env";
const DEFAULT_OUTPUT =
  "scripts/cutover/token-exchange.candidate.json";
const DEFAULT_REFERENCE_ENV =
  "../../Multi-Sync/multi-sync-frontend/.env";

function parseArguments(arguments_) {
  const options = {
    config: DEFAULT_CONFIG,
    env: DEFAULT_ENV,
    output: DEFAULT_OUTPUT,
    referenceEnv: DEFAULT_REFERENCE_ENV,
  };
  for (const argument of arguments_) {
    if (argument.startsWith("--config=")) {
      options.config = argument.slice("--config=".length);
    } else if (argument.startsWith("--env=")) {
      options.env = argument.slice("--env=".length);
    } else if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
    } else if (argument.startsWith("--reference-env=")) {
      options.referenceEnv = argument.slice("--reference-env=".length);
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: npm run prepare:token-exchange -- [options]

Read-only against MongoDB and Shopify. It writes a local candidate containing
shop domains and token fingerprints only; raw tokens are never exported.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [key, resolve(value)]),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [environment, referenceEnvironment, clientId] = await Promise.all([
    readEnvironment(options.env),
    readEnvironment(options.referenceEnv),
    readCutoverClientId(options.config),
  ]);
  if (databaseName(environment.DATABASE_URL) !== DATABASE_NAME) {
    throw new Error(
      `DATABASE_URL must target the ${DATABASE_NAME} database.`,
    );
  }
  if (
    referenceEnvironment.SHOPIFY_API_KEY !== clientId ||
    !referenceEnvironment.SHOPIFY_API_SECRET
  ) {
    throw new Error(
      "The reference environment does not belong to the cutover Shopify app.",
    );
  }

  const client = new MongoClient(environment.DATABASE_URL);
  await client.connect();
  let stores;
  try {
    stores = await client
      .db(DATABASE_NAME)
      .collection("Store")
      .find(
        { status: "INSTALLED" },
        {
          projection: {
            _id: 1,
            accessStatus: 1,
            accessToken: 1,
            accessTokenExpiresAt: 1,
            refreshToken: 1,
            refreshTokenExpiresAt: 1,
            shopDomain: 1,
          },
        },
      )
      .sort({ shopDomain: 1 })
      .toArray();
  } finally {
    await client.close();
  }

  const eligible = [];
  const skipped = [];
  for (let index = 0; index < stores.length; index += 5) {
    const batch = stores.slice(index, index + 5);
    const classified = await Promise.all(
      batch.map(async (store) => {
        const shopDomain = normalizeShop(store.shopDomain);
        if (!shopDomain) {
          return {
            skip: {
              reason: "INVALID_SHOP_DOMAIN",
              shopDomain: String(store.shopDomain),
            },
          };
        }
        if (store.accessStatus !== "ACTIVE") {
          return {
            skip: { reason: "STORE_SUSPENDED", shopDomain },
          };
        }
        if (!store.accessToken) {
          return {
            skip: { reason: "NO_ACCESS_TOKEN", shopDomain },
          };
        }
        if (
          store.accessTokenExpiresAt ||
          store.refreshToken ||
          store.refreshTokenExpiresAt
        ) {
          return {
            skip: {
              reason: store.refreshToken
                ? "ALREADY_EXPIRING"
                : "INCOMPLETE_TOKEN_STATE",
              shopDomain,
            },
          };
        }

        const validation = await validateAdminToken(
          shopDomain,
          store.accessToken,
          "2026-07",
        );
        if (!validation.ok) {
          return {
            skip: {
              httpStatus: validation.httpStatus,
              reason: "TOKEN_NOT_CURRENTLY_USABLE",
              shopDomain,
            },
          };
        }

        return {
          eligible: {
            shopDomain,
            storeId: store._id.toHexString(),
            tokenFingerprint: fingerprint(store.accessToken),
          },
        };
      }),
    );
    for (const result of classified) {
      if (result.eligible) eligible.push(result.eligible);
      else skipped.push(result.skip);
    }
  }

  const candidate = {
    formatVersion: 1,
    candidateType: "ShopifyOfflineTokenExchange",
    targetDatabase: DATABASE_NAME,
    targetApp: {
      clientIdFingerprint: fingerprint(clientId),
      clientSecretFingerprint: fingerprint(
        referenceEnvironment.SHOPIFY_API_SECRET,
      ),
      handle: "multi-sync-google-feed",
    },
    generatedAt: new Date().toISOString(),
    policy: {
      exchangesAreIrreversible: true,
      rawTokensExported: false,
      requiresPerShopCanaryByDefault: true,
    },
    eligible,
    skipped,
    summary: {
      eligible: eligible.length,
      skipped: skipped.length,
      totalInstalled: stores.length,
    },
  };
  candidate.approvalHash = approvalHash(candidate);

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(
    options.output,
    `${JSON.stringify(candidate, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        approvalHash: candidate.approvalHash,
        eligible: candidate.summary.eligible,
        note:
          "No token was exchanged and no database record was changed.",
        output: options.output,
        skipped: candidate.summary.skipped,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    `[token-exchange-preview] ${
      error instanceof Error ? error.message : error
    }`,
  );
  process.exitCode = 1;
});
