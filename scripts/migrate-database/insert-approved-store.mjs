import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient } from "mongodb";

import {
  TARGET_STORE_COLLECTION,
  isValidShopDomain,
  normalizeShopDomain,
} from "./store-transform.mjs";

const ALLOWED_FIELDS = new Set([
  "shopDomain",
  "shopPlan",
  "accessToken",
  "status",
  "accessStatus",
  "installedAt",
  "uninstalledAt",
  "createdAt",
  "updatedAt",
  "feedGenerationFeedId",
  "feedGenerationLockedAt",
  "accessTokenExpiresAt",
  "refreshToken",
  "refreshTokenExpiresAt",
  "tokenRefreshLockId",
  "tokenRefreshLockedAt",
]);

export function parseArguments(argv) {
  const options = {
    confirmTarget: null,
    copyAccessTokens: false,
    execute: false,
    file: null,
  };

  for (const argument of argv) {
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--copy-access-tokens") {
      options.copyAccessTokens = true;
    } else if (argument.startsWith("--confirm-target=")) {
      options.confirmTarget = argument.slice("--confirm-target=".length);
    } else if (argument.startsWith("--file=")) {
      options.file = argument.slice("--file=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.file) throw new Error("--file=PATH is required");
  if (!options.execute) throw new Error("--execute is required");
  return options;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseDate(value, field, nullable = false) {
  if (nullable && value === null) return null;
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw new Error(
      `${field} must be a valid ISO date${nullable ? " or null" : ""}`,
    );
  }
  return date;
}

export function validateCandidate(candidate, targetDatabase) {
  if (candidate?.formatVersion !== 1) {
    throw new Error("Unsupported candidate formatVersion");
  }
  if (candidate.targetDatabase !== targetDatabase) {
    throw new Error(
      `Candidate targets "${candidate.targetDatabase}", not "${targetDatabase}"`,
    );
  }
  if (!candidate.document || typeof candidate.document !== "object") {
    throw new Error("Candidate document is missing");
  }

  const extraFields = Object.keys(candidate.document).filter(
    (field) => !ALLOWED_FIELDS.has(field),
  );
  if (extraFields.length > 0) {
    throw new Error(`Unsupported Store fields: ${extraFields.join(", ")}`);
  }

  const shopDomain = normalizeShopDomain(candidate.document.shopDomain);
  if (!isValidShopDomain(shopDomain)) {
    throw new Error("document.shopDomain is invalid");
  }
  if (shopDomain !== normalizeShopDomain(candidate.sourceShopDomain)) {
    throw new Error("document.shopDomain cannot differ from sourceShopDomain");
  }
  if (!["INSTALLED", "UNINSTALLED"].includes(candidate.document.status)) {
    throw new Error("status must be INSTALLED or UNINSTALLED");
  }
  if (!["ACTIVE", "SUSPENDED"].includes(candidate.document.accessStatus)) {
    throw new Error("accessStatus must be ACTIVE or SUSPENDED");
  }
  if (candidate.document.accessToken !== null) {
    throw new Error(
      "Approved files cannot contain access tokens; migrate tokens separately",
    );
  }
  let shopPlan = null;
  if (
    candidate.document.shopPlan !== undefined &&
    candidate.document.shopPlan !== null
  ) {
    if (typeof candidate.document.shopPlan !== "string") {
      throw new Error("shopPlan must be a non-empty string or null");
    }
    shopPlan = candidate.document.shopPlan.trim();
    if (!shopPlan || shopPlan.length > 100) {
      throw new Error("shopPlan must be a non-empty string or null");
    }
  }

  const document = {
    shopDomain,
    shopPlan,
    accessStatus: candidate.document.accessStatus,
    accessToken: null,
    status: candidate.document.status,
    installedAt: parseDate(candidate.document.installedAt, "installedAt"),
    createdAt: parseDate(candidate.document.createdAt, "createdAt"),
    updatedAt: parseDate(candidate.document.updatedAt, "updatedAt"),
    uninstalledAt: parseDate(
      candidate.document.uninstalledAt,
      "uninstalledAt",
      true,
    ),
    feedGenerationFeedId: null,
    feedGenerationLockedAt: null,
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    tokenRefreshLockId: null,
    tokenRefreshLockedAt: null,
  };

  if (document.status === "INSTALLED") document.uninstalledAt = null;
  return document;
}

export function expandCandidateFile(candidateFile, targetDatabase) {
  if (candidateFile?.candidateType === "StoreBulk") {
    if (!Array.isArray(candidateFile.stores)) {
      throw new Error("Bulk candidate stores must be an array");
    }

    return candidateFile.stores.map((entry) => ({
      accessTokenAvailable: entry.accessTokenAvailable === true,
      document: validateCandidate(
        {
          formatVersion: candidateFile.formatVersion,
          sourceShopDomain: entry.sourceShopDomain,
          targetDatabase: candidateFile.targetDatabase,
          document: entry.document,
        },
        targetDatabase,
      ),
      sourceShopDomain: normalizeShopDomain(entry.sourceShopDomain),
    }));
  }

  return [
    {
      accessTokenAvailable: false,
      document: validateCandidate(candidateFile, targetDatabase),
      sourceShopDomain: normalizeShopDomain(candidateFile.sourceShopDomain),
    },
  ];
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const targetDatabase =
    process.env.TARGET_DATABASE_NAME?.trim() || "Multi-sync";
  if (options.confirmTarget !== targetDatabase) {
    throw new Error(`Execution requires --confirm-target=${targetDatabase}`);
  }

  const targetUri =
    process.env.TARGET_MONGODB_URI?.trim() ||
    requiredEnvironment("DATABASE_URL");
  const candidateFile = JSON.parse(
    await readFile(resolve(options.file), "utf8"),
  );
  const candidates = expandCandidateFile(candidateFile, targetDatabase);
  const duplicateDomains = candidates
    .map(({ document }) => document.shopDomain)
    .filter((domain, index, domains) => domains.indexOf(domain) !== index);
  if (duplicateDomains.length > 0) {
    throw new Error(
      `Duplicate candidate domains: ${[...new Set(duplicateDomains)].join(", ")}`,
    );
  }

  const targetClient = new MongoClient(targetUri);
  let sourceClient = null;

  try {
    await targetClient.connect();
    const collection = targetClient
      .db(targetDatabase)
      .collection(TARGET_STORE_COLLECTION);
    const existingDomains = new Set(
      (
        await collection
          .find(
            {
              shopDomain: {
                $in: candidates.map(({ document }) => document.shopDomain),
              },
            },
            { projection: { shopDomain: 1, _id: 0 } },
          )
          .toArray()
      ).map(({ shopDomain }) => shopDomain),
    );
    const missingCandidates = candidates.filter(
      ({ document }) => !existingDomains.has(document.shopDomain),
    );

    if (options.copyAccessTokens) {
      const sourceUri =
        process.env.SOURCE_MONGODB_URI?.trim() ||
        requiredEnvironment("DATABASE_URL");
      const sourceDatabase = process.env.SOURCE_DATABASE_NAME?.trim() || "gsf";
      if (sourceDatabase !== "gsf") {
        throw new Error('SOURCE_DATABASE_NAME must be exactly "gsf"');
      }

      sourceClient = new MongoClient(sourceUri, {
        readPreference: "secondaryPreferred",
      });
      await sourceClient.connect();
      const tokenDomains = missingCandidates
        .filter(
          ({ accessTokenAvailable, document }) =>
            accessTokenAvailable && document.status === "INSTALLED",
        )
        .map(({ sourceShopDomain }) => sourceShopDomain);
      const legacyStores = await sourceClient
        .db(sourceDatabase)
        .collection("Store")
        .find(
          { shopDomain: { $in: tokenDomains } },
          { projection: { shopDomain: 1, accessToken: 1 } },
        )
        .toArray();
      const tokensByShop = new Map(
        legacyStores.map((store) => [
          normalizeShopDomain(store.shopDomain),
          typeof store.accessToken === "string" ? store.accessToken.trim() : "",
        ]),
      );

      for (const candidate of missingCandidates) {
        if (
          candidate.accessTokenAvailable &&
          candidate.document.status === "INSTALLED"
        ) {
          const token = tokensByShop.get(candidate.sourceShopDomain);
          if (!token) {
            throw new Error(
              `Expected a source access token for ${candidate.sourceShopDomain}`,
            );
          }
          candidate.document.accessToken = token;
        }
      }
    }

    if (missingCandidates.length === 0) {
      console.log(
        `Inserted=0; existing skipped=${existingDomains.size}; candidate count=${candidates.length}`,
      );
      return;
    }

    const result = await collection.insertMany(
      missingCandidates.map(({ document }) => document),
      { ordered: false },
    );
    const insertedWithoutToken = missingCandidates.filter(
      ({ document }) =>
        document.status === "INSTALLED" && !document.accessToken,
    ).length;

    console.log(
      JSON.stringify(
        {
          candidateCount: candidates.length,
          inserted: result.insertedCount,
          existingSkipped: candidates.length - result.insertedCount,
          installedWithoutAccessToken: insertedWithoutToken,
          sourceWrites: 0,
          targetUpdates: 0,
          targetDeletes: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.allSettled([targetClient.close(), sourceClient?.close()]);
  }
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(
      `[Approved Store] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
