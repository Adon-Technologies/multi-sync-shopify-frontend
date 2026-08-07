import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { MongoClient, ObjectId } from "mongodb";

import {
  APP_HANDLE,
  approvalHash,
  DATABASE_NAME,
  databaseName,
  fingerprint,
  normalizeShop,
  parseTokenExchangeResponse,
  readCutoverClientId,
  readEnvironment,
  validateAdminToken,
} from "./token-exchange-common.mjs";

const SHA256 = /^[a-f0-9]{64}$/;

function parseArguments(arguments_) {
  const options = {
    all: false,
    backendEnv: "../multi-sync-backend/.env",
    config: "shopify.app.multi-sync-google-feed.toml",
    confirmHash: null,
    env: ".env",
    execute: false,
    file: null,
    shop: null,
  };
  for (const argument of arguments_) {
    if (argument === "--all") options.all = true;
    else if (argument === "--execute") options.execute = true;
    else if (argument.startsWith("--backend-env=")) {
      options.backendEnv = argument.slice("--backend-env=".length);
    } else if (argument.startsWith("--config=")) {
      options.config = argument.slice("--config=".length);
    } else if (argument.startsWith("--confirm-hash=")) {
      options.confirmHash = argument.slice("--confirm-hash=".length);
    } else if (argument.startsWith("--env=")) {
      options.env = argument.slice("--env=".length);
    } else if (argument.startsWith("--file=")) {
      options.file = argument.slice("--file=".length);
    } else if (argument.startsWith("--shop=")) {
      options.shop = normalizeShop(argument.slice("--shop=".length));
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage:
  npm run exchange:token -- --file=PATH --confirm-hash=HASH --shop=SHOP
  npm run exchange:token -- --file=PATH --confirm-hash=HASH --shop=SHOP --execute

Without --execute this command validates only. Start with one --shop canary.
Bulk execution additionally requires --all and the environment variable
ALLOW_ALL_TOKEN_EXCHANGES=I_UNDERSTAND_THE_EXCHANGE_IS_IRREVERSIBLE.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.file) throw new Error("--file=PATH is required.");
  if (!SHA256.test(options.confirmHash ?? "")) {
    throw new Error("--confirm-hash must be a 64-character SHA-256 hash.");
  }
  if (options.all && options.shop) {
    throw new Error("Choose either --shop or --all, not both.");
  }
  if (!options.all && !options.shop) {
    throw new Error("A single --shop is required unless --all is passed.");
  }
  if (
    options.execute &&
    options.all &&
    process.env.ALLOW_ALL_TOKEN_EXCHANGES !==
      "I_UNDERSTAND_THE_EXCHANGE_IS_IRREVERSIBLE"
  ) {
    throw new Error(
      "Bulk execution requires the explicit ALLOW_ALL_TOKEN_EXCHANGES confirmation.",
    );
  }
  return {
    ...options,
    backendEnv: resolve(options.backendEnv),
    config: resolve(options.config),
    env: resolve(options.env),
    file: resolve(options.file),
  };
}

function validateCandidate(candidate, expectedHash) {
  if (
    candidate?.formatVersion !== 1 ||
    candidate?.candidateType !== "ShopifyOfflineTokenExchange" ||
    candidate?.targetDatabase !== DATABASE_NAME ||
    candidate?.targetApp?.handle !== APP_HANDLE ||
    typeof candidate?.targetApp?.clientSecretFingerprint !== "string" ||
    !Array.isArray(candidate.eligible)
  ) {
    throw new Error("Unsupported token-exchange candidate.");
  }
  const computed = approvalHash(candidate);
  if (
    candidate.approvalHash !== computed ||
    expectedHash !== computed
  ) {
    throw new Error(
      "Candidate content no longer matches the explicitly approved hash.",
    );
  }
  const shops = new Set();
  for (const entry of candidate.eligible) {
    if (
      !normalizeShop(entry.shopDomain) ||
      !ObjectId.isValid(entry.storeId) ||
      typeof entry.tokenFingerprint !== "string" ||
      shops.has(entry.shopDomain)
    ) {
      throw new Error("Candidate contains an invalid or duplicate entry.");
    }
    shops.add(entry.shopDomain);
  }
  return candidate.eligible;
}

async function requestTokenExchange({
  accessToken,
  apiKey,
  apiSecret,
  shopDomain,
}) {
  const response = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: apiKey,
        client_secret: apiSecret,
        expiring: "1",
        grant_type:
          "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type:
          "urn:shopify:params:oauth:token-type:offline-access-token",
        subject_token: accessToken,
        subject_token_type:
          "urn:shopify:params:oauth:token-type:offline-access-token",
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code =
      typeof payload?.error === "string" ? payload.error : "UNKNOWN";
    throw new Error(
      `Shopify token exchange failed with HTTP ${response.status} (${code}).`,
    );
  }
  return parseTokenExchangeResponse(payload);
}

async function persistWithRetry(collection, entry, oldToken, lockId, tokens) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await collection.updateOne(
        {
          _id: new ObjectId(entry.storeId),
          accessToken: oldToken,
          shopDomain: entry.shopDomain,
          tokenRefreshLockId: lockId,
        },
        {
          $set: {
            ...tokens,
            tokenRefreshLockId: null,
            tokenRefreshLockedAt: null,
            updatedAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 1) return;
      throw new Error(
        "The Store token-exchange lock was lost before persistence.",
      );
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 250 * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [candidate, frontendEnv, backendEnv, configClientId] =
    await Promise.all([
      readFile(options.file, "utf8").then(JSON.parse),
      readEnvironment(options.env),
      readEnvironment(options.backendEnv),
      readCutoverClientId(options.config),
    ]);
  const entries = validateCandidate(candidate, options.confirmHash);
  if (
    databaseName(frontendEnv.DATABASE_URL) !== DATABASE_NAME ||
    databaseName(backendEnv.DATABASE_URL) !== DATABASE_NAME
  ) {
    throw new Error(`Both environments must target ${DATABASE_NAME}.`);
  }
  if (
    frontendEnv.SHOPIFY_API_KEY !== configClientId ||
    backendEnv.SHOPIFY_API_KEY !== configClientId
  ) {
    throw new Error(
      "Frontend/backend SHOPIFY_API_KEY must both match the cutover app before validation or execution.",
    );
  }
  if (
    !frontendEnv.SHOPIFY_API_SECRET ||
    frontendEnv.SHOPIFY_API_SECRET !== backendEnv.SHOPIFY_API_SECRET
  ) {
    throw new Error(
      "Frontend/backend SHOPIFY_API_SECRET must be configured identically.",
    );
  }
  if (
    fingerprint(frontendEnv.SHOPIFY_API_SECRET) !==
    candidate.targetApp.clientSecretFingerprint
  ) {
    throw new Error(
      "SHOPIFY_API_SECRET does not match the target app fingerprint recorded during preview.",
    );
  }

  const selected = options.all
    ? entries
    : entries.filter(({ shopDomain }) => shopDomain === options.shop);
  if (selected.length === 0) {
    throw new Error("The selected shop is not eligible in this candidate.");
  }

  const client = new MongoClient(frontendEnv.DATABASE_URL);
  await client.connect();
  const collection = client.db(DATABASE_NAME).collection("Store");
  const results = [];
  try {
    for (const entry of selected) {
      const store = await collection.findOne({
        _id: new ObjectId(entry.storeId),
        accessStatus: "ACTIVE",
        shopDomain: entry.shopDomain,
        status: "INSTALLED",
      });
      if (
        !store?.accessToken ||
        store.accessTokenExpiresAt ||
        store.refreshToken ||
        store.refreshTokenExpiresAt ||
        fingerprint(store.accessToken) !== entry.tokenFingerprint
      ) {
        throw new Error(
          `${entry.shopDomain}: Store token state changed after preview.`,
        );
      }
      const validation = await validateAdminToken(
        entry.shopDomain,
        store.accessToken,
        "2026-07",
      );
      if (!validation.ok) {
        throw new Error(
          `${entry.shopDomain}: existing token failed the final read-only check (HTTP ${validation.httpStatus ?? "network"}).`,
        );
      }

      if (!options.execute) {
        results.push({
          action: "VALIDATED_ONLY",
          shopDomain: entry.shopDomain,
          tokenFingerprint: entry.tokenFingerprint,
        });
        continue;
      }

      const lockId = `token-exchange-${randomUUID()}`;
      const locked = await collection.updateOne(
        {
          _id: store._id,
          accessToken: store.accessToken,
          accessTokenExpiresAt: null,
          refreshToken: null,
          tokenRefreshLockId: null,
        },
        {
          $set: {
            tokenRefreshLockId: lockId,
            tokenRefreshLockedAt: new Date(),
          },
        },
      );
      if (locked.modifiedCount !== 1) {
        throw new Error(
          `${entry.shopDomain}: couldn't acquire the token-exchange lock.`,
        );
      }

      try {
        const tokens = await requestTokenExchange({
          accessToken: store.accessToken,
          apiKey: configClientId,
          apiSecret: frontendEnv.SHOPIFY_API_SECRET,
          shopDomain: entry.shopDomain,
        });
        await persistWithRetry(
          collection,
          entry,
          store.accessToken,
          lockId,
          tokens,
        );
        const postCheck = await validateAdminToken(
          entry.shopDomain,
          tokens.accessToken,
          "2026-07",
        );
        if (!postCheck.ok) {
          throw new Error(
            `${entry.shopDomain}: exchanged token was saved but failed its Admin API post-check.`,
          );
        }
        results.push({
          accessTokenExpiresAt:
            tokens.accessTokenExpiresAt.toISOString(),
          action: "EXCHANGED_AND_VERIFIED",
          refreshTokenExpiresAt:
            tokens.refreshTokenExpiresAt.toISOString(),
          shopDomain: entry.shopDomain,
          tokenFingerprint: fingerprint(tokens.accessToken),
        });
      } catch (error) {
        await collection.updateOne(
          { _id: store._id, tokenRefreshLockId: lockId },
          {
            $set: {
              tokenRefreshLockId: null,
              tokenRefreshLockedAt: null,
            },
          },
        );
        throw error;
      }
    }
  } finally {
    await client.close();
  }

  console.log(
    JSON.stringify(
      {
        executed: options.execute,
        irreversibleWarning:
          "A successful exchange revokes the old non-expiring token.",
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    `[token-exchange] ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
