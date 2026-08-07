import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient, ObjectId } from "mongodb";

const TARGET_DATABASE = "Multi-sync";
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHOPIFY_SHOP_ID = /^gid:\/\/shopify\/Shop\/\d+$/;
const DOCUMENT_FIELDS = new Set([
  "storeId",
  "shopifyShopId",
  "planHandle",
  "status",
  "billingPeriod",
  "trialEndsAt",
  "currentBillingCycleStart",
  "currentBillingCycleEnd",
  "cancelAtEndOfCycle",
  "lastSyncedAt",
  "lastSyncError",
  "createdAt",
  "updatedAt",
]);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArguments(arguments_) {
  const options = {
    confirmHash: null,
    confirmRuntimeSupport: null,
    confirmTarget: null,
    execute: false,
    file: null,
    validateOnly: false,
  };
  for (const argument of arguments_) {
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--validate-only") {
      options.validateOnly = true;
    } else if (argument.startsWith("--confirm-hash=")) {
      options.confirmHash = argument.slice("--confirm-hash=".length);
    } else if (argument.startsWith("--confirm-runtime-support=")) {
      options.confirmRuntimeSupport = argument.slice(
        "--confirm-runtime-support=".length,
      );
    } else if (argument.startsWith("--confirm-target=")) {
      options.confirmTarget = argument.slice("--confirm-target=".length);
    } else if (argument.startsWith("--file=")) {
      options.file = argument.slice("--file=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.execute === options.validateOnly) {
    throw new Error("Pass exactly one of --execute or --validate-only");
  }
  if (!options.file) throw new Error("--file=PATH is required");
  if (options.execute && options.confirmTarget !== TARGET_DATABASE) {
    throw new Error(`Execution requires --confirm-target=${TARGET_DATABASE}`);
  }
  if (!SHA256.test(options.confirmHash ?? "")) {
    throw new Error("--confirm-hash must be the candidate approvalHash");
  }
  return options;
}

function parseDate(value, field, shopDomain, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const date = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(date.getTime())) {
    throw new Error(`${shopDomain}: ${field} must be an ISO date`);
  }
  return date;
}

function validateEntry(entry) {
  if (
    entry?.action !== "insert" ||
    typeof entry.shopDomain !== "string" ||
    !SHOP_PATTERN.test(entry.shopDomain)
  ) {
    throw new Error("Candidate contains an invalid subscription entry");
  }
  const document = entry.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${entry.shopDomain}: document is missing`);
  }
  const unsupported = Object.keys(document).filter(
    (field) => !DOCUMENT_FIELDS.has(field),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${entry.shopDomain}: unsupported fields: ${unsupported.join(", ")}`,
    );
  }
  if (!ObjectId.isValid(document.storeId)) {
    throw new Error(`${entry.shopDomain}: invalid storeId`);
  }
  if (!SHOPIFY_SHOP_ID.test(document.shopifyShopId)) {
    throw new Error(`${entry.shopDomain}: invalid shopifyShopId`);
  }
  if (
    typeof document.planHandle !== "string" ||
    !document.planHandle.trim()
  ) {
    throw new Error(`${entry.shopDomain}: invalid planHandle`);
  }
  if (document.status !== "ACTIVE") {
    throw new Error(`${entry.shopDomain}: status must be ACTIVE`);
  }
  if (
    typeof document.billingPeriod !== "string" ||
    !document.billingPeriod.trim()
  ) {
    throw new Error(`${entry.shopDomain}: invalid billingPeriod`);
  }
  if (
    document.trialEndsAt !== null ||
    document.lastSyncError !== null ||
    typeof document.cancelAtEndOfCycle !== "boolean"
  ) {
    throw new Error(`${entry.shopDomain}: unsafe nullable/boolean fields`);
  }

  const currentBillingCycleStart = parseDate(
    document.currentBillingCycleStart,
    "currentBillingCycleStart",
    entry.shopDomain,
  );
  const currentBillingCycleEnd = parseDate(
    document.currentBillingCycleEnd,
    "currentBillingCycleEnd",
    entry.shopDomain,
  );
  if (
    currentBillingCycleEnd.getTime() <= currentBillingCycleStart.getTime()
  ) {
    throw new Error(`${entry.shopDomain}: billing cycle dates are invalid`);
  }

  return {
    shopDomain: entry.shopDomain,
    document: {
      ...document,
      storeId: new ObjectId(document.storeId),
      planHandle: document.planHandle.trim(),
      trialEndsAt: null,
      currentBillingCycleStart,
      currentBillingCycleEnd,
      lastSyncedAt: parseDate(
        document.lastSyncedAt,
        "lastSyncedAt",
        entry.shopDomain,
      ),
      createdAt: parseDate(
        document.createdAt,
        "createdAt",
        entry.shopDomain,
      ),
      updatedAt: parseDate(
        document.updatedAt,
        "updatedAt",
        entry.shopDomain,
      ),
    },
  };
}

function computeCandidateHash(candidate) {
  const { approvalHash: _approvalHash, ...candidateWithoutHash } = candidate;
  return createHash("sha256")
    .update(JSON.stringify(candidateWithoutHash))
    .digest("hex");
}

export function validateSubscriptionCandidate(candidate, confirmHash) {
  if (
    candidate?.formatVersion !== 1 ||
    candidate?.candidateType !== "StoreSubscriptionBulkInsert" ||
    candidate?.targetDatabase !== TARGET_DATABASE ||
    !Array.isArray(candidate.subscriptions) ||
    candidate.subscriptions.length === 0
  ) {
    throw new Error("Unsupported StoreSubscription candidate");
  }
  if (
    candidate.policy?.updatesAllowed !== false ||
    candidate.policy?.deletesAllowed !== false ||
    candidate.policy?.insertsAllowedAfterApproval !== true
  ) {
    throw new Error("Candidate policy is unsafe");
  }
  const computedHash = computeCandidateHash(candidate);
  if (
    candidate.approvalHash !== computedHash ||
    confirmHash !== computedHash
  ) {
    throw new Error(
      "Candidate hash does not match the approved hash; regenerate or review the file",
    );
  }

  const entries = candidate.subscriptions.map(validateEntry);
  if (
    entries.length !== candidate.policy.expectedSubscriptions ||
    entries.length !== candidate.summary?.proposedInserts
  ) {
    throw new Error("Candidate subscription count does not match its policy");
  }
  const domains = new Set();
  const storeIds = new Set();
  const shopifyShopIds = new Set();
  for (const entry of entries) {
    const storeId = entry.document.storeId.toHexString();
    if (
      domains.has(entry.shopDomain) ||
      storeIds.has(storeId) ||
      shopifyShopIds.has(entry.document.shopifyShopId)
    ) {
      throw new Error("Candidate contains duplicate subscription identities");
    }
    domains.add(entry.shopDomain);
    storeIds.add(storeId);
    shopifyShopIds.add(entry.document.shopifyShopId);
  }
  return entries;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const candidate = JSON.parse(
    await readFile(resolve(options.file), "utf8"),
  );
  const entries = validateSubscriptionCandidate(
    candidate,
    options.confirmHash,
  );
  if (options.validateOnly) {
    console.log(
      JSON.stringify(
        {
          approvalHash: candidate.approvalHash,
          candidateValid: true,
          proposedInserts: entries.length,
          writes: 0,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (
    candidate.policy?.legacyBillingRuntimeSupportRequired === true &&
    candidate.summary?.legacyBillingFallbacks > 0 &&
    options.confirmRuntimeSupport !== "implemented"
  ) {
    throw new Error(
      "This candidate contains legacy Billing API subscriptions. Implement the runtime legacy-billing fallback, then pass --confirm-runtime-support=implemented.",
    );
  }
  const client = new MongoClient(requiredEnvironment("DATABASE_URL"));

  try {
    await client.connect();
    const session = client.startSession();
    let inserted = 0;
    try {
      await session.withTransaction(async () => {
        const database = client.db(TARGET_DATABASE);
        const storeIds = entries.map(({ document }) => document.storeId);
        const stores = await database
          .collection("Store")
          .find(
            { _id: { $in: storeIds } },
            { projection: { shopDomain: 1, status: 1 }, session },
          )
          .toArray();
        const storesById = new Map(
          stores.map((store) => [String(store._id), store]),
        );
        for (const entry of entries) {
          const store = storesById.get(entry.document.storeId.toHexString());
          if (
            store?.shopDomain !== entry.shopDomain ||
            store.status !== "INSTALLED"
          ) {
            throw new Error(
              `${entry.shopDomain}: Store changed; regenerate the candidate`,
            );
          }
        }

        const subscriptions = database.collection("StoreSubscription");
        const collisions = await subscriptions
          .find(
            {
              $or: [
                { storeId: { $in: storeIds } },
                {
                  shopifyShopId: {
                    $in: entries.map(
                      ({ document }) => document.shopifyShopId,
                    ),
                  },
                },
              ],
            },
            { projection: { _id: 1 }, session },
          )
          .toArray();
        if (collisions.length > 0) {
          throw new Error(
            "A candidate Store already has a subscription; regenerate the candidate",
          );
        }

        const result = await subscriptions.insertMany(
          entries.map(({ document }) => document),
          { ordered: true, session },
        );
        if (result.insertedCount !== entries.length) {
          throw new Error("Not every approved subscription was inserted");
        }
        inserted = result.insertedCount;
      });
    } finally {
      await session.endSession();
    }

    console.log(
      JSON.stringify(
        {
          approvalHash: candidate.approvalHash,
          database: TARGET_DATABASE,
          inserted,
          updates: 0,
          deletes: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
