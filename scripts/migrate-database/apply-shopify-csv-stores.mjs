import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient, ObjectId } from "mongodb";

import { isValidShopDomain, normalizeShopDomain } from "./store-transform.mjs";

const INSERT_FIELDS = new Set([
  "shopDomain",
  "shopPlan",
  "accessStatus",
  "accessToken",
  "status",
  "installedAt",
  "createdAt",
  "updatedAt",
  "uninstalledAt",
  "feedGenerationFeedId",
  "feedGenerationLockedAt",
  "accessTokenExpiresAt",
  "refreshToken",
  "refreshTokenExpiresAt",
  "tokenRefreshLockId",
  "tokenRefreshLockedAt",
]);
const CHANGE_FIELDS = new Set([
  "shopPlan",
  "status",
  "uninstalledAt",
  "updatedAt",
]);

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

function normalizedPlan(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    throw new Error(`${field} must be a non-empty Shopify plan`);
  }
  return value.trim();
}

function assertOnlyFields(document, allowed, label) {
  const unsupported = Object.keys(document).filter(
    (field) => !allowed.has(field),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${label} has unsupported fields: ${unsupported.join(", ")}`,
    );
  }
}

function validateInsert(entry) {
  if (
    entry.targetId !== null ||
    entry.before !== null ||
    entry.changes !== null
  ) {
    throw new Error(`${entry.sourceShopDomain}: invalid insert structure`);
  }
  if (!entry.document || typeof entry.document !== "object") {
    throw new Error(`${entry.sourceShopDomain}: insert document is missing`);
  }
  assertOnlyFields(entry.document, INSERT_FIELDS, entry.sourceShopDomain);
  if (
    normalizeShopDomain(entry.document.shopDomain) !== entry.sourceShopDomain
  ) {
    throw new Error(`${entry.sourceShopDomain}: insert domain changed`);
  }
  if (entry.document.status !== "INSTALLED") {
    throw new Error(`${entry.sourceShopDomain}: CSV insert must be INSTALLED`);
  }
  if (entry.document.accessToken !== null) {
    throw new Error(
      `${entry.sourceShopDomain}: candidate cannot contain a token`,
    );
  }
  if (!["ACTIVE", "SUSPENDED"].includes(entry.document.accessStatus)) {
    throw new Error(`${entry.sourceShopDomain}: invalid accessStatus`);
  }
  if (entry.document.uninstalledAt !== null) {
    throw new Error(
      `${entry.sourceShopDomain}: installed Store cannot have uninstalledAt`,
    );
  }

  return {
    shopDomain: entry.sourceShopDomain,
    shopPlan: normalizedPlan(entry.document.shopPlan, "document.shopPlan"),
    accessStatus: entry.document.accessStatus,
    accessToken: null,
    status: "INSTALLED",
    installedAt: parseDate(entry.document.installedAt, "installedAt"),
    createdAt: parseDate(entry.document.createdAt, "createdAt"),
    updatedAt: parseDate(entry.document.updatedAt, "updatedAt"),
    uninstalledAt: null,
    feedGenerationFeedId: null,
    feedGenerationLockedAt: null,
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    tokenRefreshLockId: null,
    tokenRefreshLockedAt: null,
  };
}

function validateUpdate(entry) {
  if (!["update", "reactivate"].includes(entry.action)) {
    throw new Error(`${entry.sourceShopDomain}: invalid update action`);
  }
  if (
    !ObjectId.isValid(entry.targetId) ||
    !entry.before ||
    typeof entry.before !== "object" ||
    !entry.changes ||
    typeof entry.changes !== "object" ||
    entry.document !== null
  ) {
    throw new Error(`${entry.sourceShopDomain}: invalid update structure`);
  }
  assertOnlyFields(entry.changes, CHANGE_FIELDS, entry.sourceShopDomain);
  if (entry.before.shopDomain !== entry.sourceShopDomain) {
    throw new Error(`${entry.sourceShopDomain}: before domain changed`);
  }
  if (!["INSTALLED", "UNINSTALLED"].includes(entry.before.status)) {
    throw new Error(`${entry.sourceShopDomain}: invalid previous status`);
  }
  if (entry.action === "update" && entry.before.status !== "INSTALLED") {
    throw new Error(`${entry.sourceShopDomain}: update must start INSTALLED`);
  }
  if (entry.action === "reactivate" && entry.before.status === "INSTALLED") {
    throw new Error(
      `${entry.sourceShopDomain}: reactivation must change status`,
    );
  }
  if (
    entry.changes.status !== "INSTALLED" ||
    entry.changes.uninstalledAt !== null
  ) {
    throw new Error(`${entry.sourceShopDomain}: CSV update must be INSTALLED`);
  }

  return {
    action: entry.action,
    shopDomain: entry.sourceShopDomain,
    targetId: new ObjectId(entry.targetId),
    before: {
      shopPlan:
        typeof entry.before.shopPlan === "string"
          ? entry.before.shopPlan
          : null,
      status: entry.before.status,
      uninstalledAt: parseDate(
        entry.before.uninstalledAt,
        "before.uninstalledAt",
        true,
      ),
      updatedAt: parseDate(entry.before.updatedAt, "before.updatedAt"),
    },
    changes: {
      shopPlan: normalizedPlan(entry.changes.shopPlan, "changes.shopPlan"),
      status: "INSTALLED",
      uninstalledAt: null,
      updatedAt: parseDate(entry.changes.updatedAt, "changes.updatedAt"),
    },
  };
}

export function validateCandidate(candidate, targetDatabase) {
  if (
    candidate?.formatVersion !== 1 ||
    candidate?.candidateType !== "StoreCsvReconciliation"
  ) {
    throw new Error("Unsupported Store CSV candidate");
  }
  if (candidate.targetDatabase !== targetDatabase) {
    throw new Error(
      `Candidate targets "${candidate.targetDatabase}", not "${targetDatabase}"`,
    );
  }
  if (!Array.isArray(candidate.stores) || candidate.stores.length === 0) {
    throw new Error("Candidate stores must be a non-empty array");
  }
  if (candidate.policy?.deletesAllowed !== false) {
    throw new Error("Candidate must explicitly prohibit deletes");
  }

  const domains = new Set();
  const targetIds = new Set();
  return candidate.stores.map((entry) => {
    const shopDomain = normalizeShopDomain(entry.sourceShopDomain);
    if (!isValidShopDomain(shopDomain)) {
      throw new Error("Candidate contains an invalid shop domain");
    }
    if (domains.has(shopDomain)) {
      throw new Error(`Candidate contains duplicate shop: ${shopDomain}`);
    }
    domains.add(shopDomain);
    if (
      normalizedPlan(entry.shopifyPlan, "shopifyPlan") !== entry.shopifyPlan
    ) {
      throw new Error(`${shopDomain}: entry plan is not normalized`);
    }

    if (entry.action === "insert") {
      const operation = {
        action: "insert",
        shopDomain,
        document: validateInsert({
          ...entry,
          sourceShopDomain: shopDomain,
        }),
      };
      if (operation.document.shopPlan !== entry.shopifyPlan) {
        throw new Error(`${shopDomain}: entry and document plans differ`);
      }
      return operation;
    }

    const update = validateUpdate({
      ...entry,
      sourceShopDomain: shopDomain,
    });
    const targetId = update.targetId.toHexString();
    if (targetIds.has(targetId)) {
      throw new Error(`Candidate contains duplicate target ID: ${targetId}`);
    }
    targetIds.add(targetId);
    if (update.changes.shopPlan !== entry.shopifyPlan) {
      throw new Error(`${shopDomain}: entry and changes plans differ`);
    }
    return update;
  });
}

function sameDate(left, right) {
  const leftTime = left instanceof Date ? left.getTime() : null;
  const rightTime = right instanceof Date ? right.getTime() : null;
  return leftTime === rightTime;
}

function assertCurrentState(operation, current) {
  if (operation.action === "insert") {
    if (current) {
      throw new Error(
        `${operation.shopDomain}: Store now exists; regenerate the candidate`,
      );
    }
    return;
  }
  if (!current || String(current._id) !== operation.targetId.toHexString()) {
    throw new Error(`${operation.shopDomain}: target Store identity changed`);
  }
  if (
    current.status !== operation.before.status ||
    (current.shopPlan ?? null) !== operation.before.shopPlan ||
    !sameDate(current.uninstalledAt ?? null, operation.before.uninstalledAt) ||
    !sameDate(current.updatedAt, operation.before.updatedAt)
  ) {
    throw new Error(
      `${operation.shopDomain}: target Store changed; regenerate the candidate`,
    );
  }
}

export function parseArguments(arguments_) {
  const options = {
    confirmTarget: null,
    execute: false,
    file: null,
  };
  for (const argument of arguments_) {
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument.startsWith("--confirm-target=")) {
      options.confirmTarget = argument.slice("--confirm-target=".length);
    } else if (argument.startsWith("--file=")) {
      options.file = argument.slice("--file=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.execute) throw new Error("--execute is required");
  if (!options.file) throw new Error("--file=PATH is required");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const targetDatabase =
    process.env.TARGET_DATABASE_NAME?.trim() || "Multi-sync";
  if (options.confirmTarget !== targetDatabase) {
    throw new Error(`Execution requires --confirm-target=${targetDatabase}`);
  }
  const mongoUri =
    process.env.TARGET_MONGODB_URI?.trim() || process.env.DATABASE_URL?.trim();
  if (!mongoUri)
    throw new Error("TARGET_MONGODB_URI or DATABASE_URL is required");

  const candidate = JSON.parse(await readFile(resolve(options.file), "utf8"));
  const operations = validateCandidate(candidate, targetDatabase);
  const client = new MongoClient(mongoUri);
  const session = client.startSession();
  const result = {
    candidateStores: operations.length,
    inserted: 0,
    updated: 0,
    reactivated: operations.filter(
      (operation) => operation.action === "reactivate",
    ).length,
    deletes: 0,
  };

  try {
    await client.connect();
    const collection = client.db(targetDatabase).collection("Store");
    await session.withTransaction(async () => {
      const currentStores = await collection
        .find(
          {
            shopDomain: {
              $in: operations.map((operation) => operation.shopDomain),
            },
          },
          { session },
        )
        .toArray();
      const currentByShop = new Map(
        currentStores.map((store) => [store.shopDomain, store]),
      );
      for (const operation of operations) {
        assertCurrentState(operation, currentByShop.get(operation.shopDomain));
      }

      const bulkResult = await collection.bulkWrite(
        operations.map((operation) =>
          operation.action === "insert"
            ? { insertOne: { document: operation.document } }
            : {
                updateOne: {
                  filter: { _id: operation.targetId },
                  update: { $set: operation.changes },
                },
              },
        ),
        { ordered: true, session },
      );
      result.inserted = bulkResult.insertedCount;
      result.updated = bulkResult.modifiedCount;
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.endSession();
    await client.close();
  }
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(
      `[Approved Shopify CSV Stores] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
