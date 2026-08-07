import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient } from "mongodb";

const SOURCE_DATABASE = "gsf";
const TARGET_DATABASE = "Multi-sync";
const EXPECTED_SUBSCRIBERS = 37;
const DEFAULT_OUTPUT =
  "scripts/migrate-database/subscriptions.candidate.json";
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const ADMIN_QUERY = `#graphql
  query SubscriptionMigrationIdentity {
    shop {
      id
      myshopifyDomain
    }
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
              }
            }
          }
        }
      }
    }
  }
`;

const PARTNER_QUERY = `#graphql
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      shop {
        id
        myshopifyDomain
      }
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      currentBillingCycle {
        startTime
        endTime
      }
      items {
        handle
        description
        price {
          __typename
          active
        }
      }
      pendingUpdate {
        billingPeriod
        items {
          handle
        }
      }
      legacySubscriptionId
    }
  }
`;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeShop(value) {
  const shop =
    typeof value === "string"
      ? value.normalize("NFKC").trim().toLowerCase()
      : "";
  return SHOP_PATTERN.test(shop) ? shop : "";
}

function parseArguments(arguments_) {
  const options = {
    expected: EXPECTED_SUBSCRIBERS,
    output: DEFAULT_OUTPUT,
    planHandle: "pro-plan",
  };
  for (const argument of arguments_) {
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: npm run prepare:subscriptions -- [--expected=37] [--plan-handle=pro-plan] [--output=PATH]",
      );
      console.log(
        "Read-only: reads gsf and Multi-sync, queries Shopify, and writes only a local candidate JSON file.",
      );
      process.exit(0);
    }
    if (argument.startsWith("--expected=")) {
      options.expected = Number(argument.slice("--expected=".length));
      continue;
    }
    if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
      continue;
    }
    if (argument.startsWith("--plan-handle=")) {
      options.planHandle = argument.slice("--plan-handle=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isSafeInteger(options.expected) || options.expected < 1) {
    throw new Error("--expected must be a positive integer");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.planHandle)) {
    throw new Error("--plan-handle must be a lowercase Shopify plan handle");
  }
  return {
    expected: options.expected,
    output: resolve(options.output),
    planHandle: options.planHandle,
  };
}

function wait(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function fetchGraphQl({
  body,
  endpoint,
  headers,
  label,
  maximumAttempts = 4,
}) {
  let lastError = null;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      const graphqlErrors = Array.isArray(payload.errors)
        ? payload.errors
            .map(({ message }) => String(message ?? "").trim())
            .filter(Boolean)
        : [];
      if (response.ok && graphqlErrors.length === 0 && payload.data) {
        return payload.data;
      }

      lastError =
        graphqlErrors.join("; ") || `${label} returned HTTP ${response.status}`;
      const retryable =
        response.status === 429 ||
        (response.status >= 500 && response.status < 600);
      if (!retryable || attempt === maximumAttempts - 1) break;

      const retryAfter = Number(response.headers.get("Retry-After"));
      await wait(
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.min(retryAfter * 1_000, 10_000)
          : 400 * 2 ** attempt,
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maximumAttempts - 1) {
        await wait(400 * 2 ** attempt);
      }
    }
  }
  throw new Error(`${label}: ${lastError ?? "request failed"}`);
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

function trialEndsAt(subscription) {
  const createdAt = new Date(subscription.createdAt);
  const trialDays = Number(subscription.trialDays);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    !Number.isFinite(trialDays) ||
    trialDays <= 0
  ) {
    return null;
  }
  return new Date(createdAt.getTime() + Math.floor(trialDays) * 86_400_000);
}

export function isLivePayingSubscriber(subscription, now = new Date()) {
  if (
    !subscription ||
    subscription.status !== "ACTIVE" ||
    subscription.test === true
  ) {
    return false;
  }
  const trialEnd = trialEndsAt(subscription);
  return !trialEnd || trialEnd.getTime() <= now.getTime();
}

function activePlanItem(subscription) {
  return (
    subscription.items.find(
      (item) => item?.price?.active !== false && item?.handle?.trim(),
    ) ??
    subscription.items.find((item) => item?.handle?.trim()) ??
    null
  );
}

function adminBillingPeriod(subscription, shopDomain) {
  const recurringItems = (subscription.lineItems ?? [])
    .map(({ plan }) => plan?.pricingDetails)
    .filter(({ __typename } = {}) => __typename === "AppRecurringPricing");
  if (recurringItems.length !== 1 || !recurringItems[0].interval) {
    throw new Error(
      `${shopDomain}: Admin API did not return one recurring billing interval`,
    );
  }
  return recurringItems[0].interval;
}

function deriveLegacyCycleStart(currentPeriodEnd, billingPeriod, shopDomain) {
  const end = new Date(currentPeriodEnd);
  if (!Number.isFinite(end.getTime())) {
    throw new Error(`${shopDomain}: invalid legacy currentPeriodEnd`);
  }
  if (billingPeriod === "EVERY_30_DAYS") {
    return new Date(end.getTime() - 30 * 86_400_000);
  }
  if (billingPeriod === "ANNUAL") {
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return start;
  }
  throw new Error(
    `${shopDomain}: unsupported legacy billing period ${billingPeriod}`,
  );
}

function validIso(value, field, shopDomain, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const date = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(date.getTime())) {
    throw new Error(`${shopDomain}: Shopify returned invalid ${field}`);
  }
  return date.toISOString();
}

export function buildSubscriptionEntry({
  adminSubscription,
  generatedAt,
  partnerError = null,
  partnerSubscription,
  planHandle: configuredPlanHandle = "pro-plan",
  shopDomain,
  shopifyShopId,
  storeId,
}) {
  if (!isLivePayingSubscriber(adminSubscription, generatedAt)) {
    throw new Error(`${shopDomain}: not a live paying subscriber`);
  }
  const generatedIso = generatedAt.toISOString();
  const warnings = [];
  let billingPeriod;
  let cancelAtEndOfCycle;
  let currentBillingCycleEnd;
  let currentBillingCycleStart;
  let planHandle;
  let trialEndsAtValue;

  if (partnerSubscription) {
    const returnedDomain = normalizeShop(
      partnerSubscription.shop?.myshopifyDomain,
    );
    if (
      returnedDomain !== shopDomain ||
      partnerSubscription.shop?.id !== shopifyShopId
    ) {
      throw new Error(`${shopDomain}: Partner API identity mismatch`);
    }
    if (
      partnerSubscription.legacySubscriptionId &&
      partnerSubscription.legacySubscriptionId !== adminSubscription.id
    ) {
      throw new Error(`${shopDomain}: Shopify subscription identity mismatch`);
    }

    const planItem = activePlanItem(partnerSubscription);
    planHandle = planItem?.handle?.trim();
    if (!planHandle) {
      throw new Error(`${shopDomain}: Partner API returned no plan handle`);
    }
    if (!partnerSubscription.currentBillingCycle) {
      throw new Error(
        `${shopDomain}: Partner API returned no current billing cycle for a non-trial subscriber`,
      );
    }
    billingPeriod = partnerSubscription.billingPeriod;
    cancelAtEndOfCycle =
      partnerSubscription.cancelAtEndOfCycle === true;
    currentBillingCycleStart = validIso(
      partnerSubscription.currentBillingCycle.startTime,
      "currentBillingCycleStart",
      shopDomain,
    );
    currentBillingCycleEnd = validIso(
      partnerSubscription.currentBillingCycle.endTime,
      "currentBillingCycleEnd",
      shopDomain,
    );
    trialEndsAtValue = validIso(
      partnerSubscription.trialEndsAt,
      "trialEndsAt",
      shopDomain,
      { nullable: true },
    );
  } else {
    billingPeriod = adminBillingPeriod(adminSubscription, shopDomain);
    currentBillingCycleEnd = validIso(
      adminSubscription.currentPeriodEnd,
      "currentPeriodEnd",
      shopDomain,
    );
    currentBillingCycleStart = deriveLegacyCycleStart(
      currentBillingCycleEnd,
      billingPeriod,
      shopDomain,
    ).toISOString();
    planHandle = configuredPlanHandle;
    cancelAtEndOfCycle = false;
    trialEndsAtValue = null;
    warnings.push(
      "Legacy Billing API subscription: Partner activeSubscription returned no managed-pricing contract",
      "currentBillingCycleStart is derived from Shopify currentPeriodEnd and the recurring billing interval",
      "cancelAtEndOfCycle is unavailable in the legacy Admin API and uses false as the migration default",
      `planHandle is mapped to the approved target handle "${configuredPlanHandle}" because legacy Billing API exposes a plan name, not a managed-pricing handle`,
    );
  }
  if (partnerError) {
    warnings.push(`Partner API check failed: ${partnerError}`);
  }
  if (partnerSubscription?.pendingUpdate) {
    warnings.push(
      "Shopify reports a pending plan update; the current StoreSubscription model has no pending-update fields",
    );
  }

  return {
    action: "insert",
    shopDomain,
    evidence: {
      adminSubscriptionCreatedAt: validIso(
        adminSubscription.createdAt,
        "subscription createdAt",
        shopDomain,
      ),
      adminSubscriptionId: adminSubscription.id,
      adminSubscriptionName: adminSubscription.name,
      adminCurrentPeriodEnd: validIso(
        adminSubscription.currentPeriodEnd,
        "currentPeriodEnd",
        shopDomain,
        { nullable: true },
      ),
      fetchedAt: generatedIso,
      partnerLegacySubscriptionId:
        partnerSubscription?.legacySubscriptionId ?? null,
      fieldSources: {
        billingPeriod: partnerSubscription
          ? "Shopify Partner API"
          : "Shopify Admin API recurring interval",
        cancelAtEndOfCycle: partnerSubscription
          ? "Shopify Partner API"
          : "migration default (legacy API field unavailable)",
        currentBillingCycleEnd: partnerSubscription
          ? "Shopify Partner API"
          : "Shopify Admin API currentPeriodEnd",
        currentBillingCycleStart: partnerSubscription
          ? "Shopify Partner API"
          : "derived from currentPeriodEnd and billingPeriod",
        planHandle: partnerSubscription
          ? "Shopify Partner API"
          : "approved target plan-handle mapping",
      },
    },
    warnings,
    document: {
      storeId,
      shopifyShopId,
      planHandle,
      status: "ACTIVE",
      billingPeriod,
      trialEndsAt: trialEndsAtValue,
      currentBillingCycleStart,
      currentBillingCycleEnd,
      cancelAtEndOfCycle,
      lastSyncedAt: generatedIso,
      lastSyncError: null,
      createdAt: validIso(
        adminSubscription.createdAt,
        "subscription createdAt",
        shopDomain,
      ),
      updatedAt: generatedIso,
    },
  };
}

function candidateHash(candidateWithoutHash) {
  return createHash("sha256")
    .update(JSON.stringify(candidateWithoutHash))
    .digest("hex");
}

async function createCandidate({ expected, output, planHandle }) {
  const generatedAt = new Date();
  const mongoClient = new MongoClient(requiredEnvironment("DATABASE_URL"), {
    readPreference: "secondaryPreferred",
  });
  const adminApiVersion =
    process.env.SHOPIFY_API_VERSION?.trim() || "2026-07";
  const partnerApiVersion =
    process.env.SHOPIFY_PARTNER_API_VERSION?.trim() || "2026-07";
  const partnerOrgId = requiredEnvironment("SHOPIFY_PARTNER_ORG_ID");
  const partnerAccessToken = requiredEnvironment(
    "SHOPIFY_PARTNER_ACCESS_TOKEN",
  );
  const configuredAppId = requiredEnvironment("SHOPIFY_APP_ID");
  const appId = configuredAppId.startsWith("gid://")
    ? configuredAppId
    : `gid://shopify/App/${configuredAppId}`;
  const partnerEndpoint = `https://partners.shopify.com/${encodeURIComponent(
    partnerOrgId,
  )}/api/${encodeURIComponent(partnerApiVersion)}/graphql.json`;

  try {
    await mongoClient.connect();
    const source = mongoClient.db(SOURCE_DATABASE);
    const target = mongoClient.db(TARGET_DATABASE);
    const [legacyStores, targetStores, existingSubscriptions] =
      await Promise.all([
        source
          .collection("Store")
          .find(
            {},
            { projection: { accessToken: 1, shopDomain: 1 } },
          )
          .toArray(),
        target
          .collection("Store")
          .find(
            { status: "INSTALLED" },
            { projection: { shopDomain: 1, status: 1 } },
          )
          .toArray(),
        target
          .collection("StoreSubscription")
          .find({}, { projection: { storeId: 1 } })
          .toArray(),
      ]);

    const legacyByShop = new Map(
      legacyStores.map((store) => [normalizeShop(store.shopDomain), store]),
    );
    const subscribedStoreIds = new Set(
      existingSubscriptions.map(({ storeId }) => String(storeId)),
    );
    const queryable = targetStores
      .map((store) => ({
        accessToken: legacyByShop.get(normalizeShop(store.shopDomain))
          ?.accessToken,
        shopDomain: normalizeShop(store.shopDomain),
        storeId: String(store._id),
      }))
      .filter(({ accessToken, storeId }) => accessToken && !subscribedStoreIds.has(storeId))
      .sort((left, right) => left.shopDomain.localeCompare(right.shopDomain));

    const adminResults = await mapWithConcurrency(
      queryable,
      4,
      async (store) => {
        try {
          const data = await fetchGraphQl({
            body: { query: ADMIN_QUERY },
            endpoint: `https://${store.shopDomain}/admin/api/${adminApiVersion}/graphql.json`,
            headers: { "X-Shopify-Access-Token": store.accessToken },
            label: `${store.shopDomain} Admin API`,
          });
          const returnedDomain = normalizeShop(data.shop?.myshopifyDomain);
          if (
            returnedDomain !== store.shopDomain ||
            typeof data.shop?.id !== "string"
          ) {
            throw new Error("Admin API identity mismatch");
          }
          const subscribers = (
            data.currentAppInstallation?.activeSubscriptions ?? []
          ).filter((subscription) =>
            isLivePayingSubscriber(subscription, generatedAt),
          );
          if (subscribers.length > 1) {
            throw new Error("multiple live paying subscriptions returned");
          }
          return {
            ...store,
            adminError: null,
            adminSubscription: subscribers[0] ?? null,
            shopifyShopId: data.shop.id,
          };
        } catch (error) {
          return {
            ...store,
            adminError: error instanceof Error ? error.message : String(error),
            adminSubscription: null,
            shopifyShopId: null,
          };
        }
      },
    );

    const liveSubscribers = adminResults.filter(
      ({ adminSubscription }) => adminSubscription,
    );
    if (liveSubscribers.length !== expected) {
      throw new Error(
        `Expected ${expected} live paying subscribers, Shopify returned ${liveSubscribers.length}. No candidate was written.`,
      );
    }

    const partnerResults = await mapWithConcurrency(
      liveSubscribers,
      4,
      async (store) => {
        try {
          const data = await fetchGraphQl({
            body: {
              query: PARTNER_QUERY,
              variables: { appId, shopId: store.shopifyShopId },
            },
            endpoint: partnerEndpoint,
            headers: { "X-Shopify-Access-Token": partnerAccessToken },
            label: `${store.shopDomain} Partner API`,
          });
          return {
            ...store,
            partnerError: null,
            partnerSubscription: data.activeSubscription ?? null,
          };
        } catch (error) {
          return {
            ...store,
            partnerError:
              error instanceof Error ? error.message : String(error),
            partnerSubscription: null,
          };
        }
      },
    );

    const subscriptions = partnerResults
      .map((result) =>
        buildSubscriptionEntry({
          adminSubscription: result.adminSubscription,
          generatedAt,
          partnerError: result.partnerError,
          partnerSubscription: result.partnerSubscription,
          planHandle,
          shopDomain: result.shopDomain,
          shopifyShopId: result.shopifyShopId,
          storeId: result.storeId,
        }),
      )
      .sort((left, right) => left.shopDomain.localeCompare(right.shopDomain));

    const candidateWithoutHash = {
      formatVersion: 1,
      candidateType: "StoreSubscriptionBulkInsert",
      generatedAt: generatedAt.toISOString(),
      sourceDatabase: SOURCE_DATABASE,
      targetDatabase: TARGET_DATABASE,
      policy: {
        databaseWritesDuringPreparation: 0,
        shopifyWrites: 0,
        insertsAllowedAfterApproval: true,
        updatesAllowed: false,
        deletesAllowed: false,
        expectedSubscriptions: expected,
        legacyBillingRuntimeSupportRequired: true,
      },
      summary: {
        targetInstalledStores: targetStores.length,
        existingTargetSubscriptions: existingSubscriptions.length,
        gsfStoreDocuments: legacyStores.length,
        queryableInstalledStoresWithoutSubscription: queryable.length,
        adminQueryFailures: adminResults.filter(({ adminError }) => adminError)
          .length,
        livePayingSubscribers: liveSubscribers.length,
        partnerManagedPricingContracts: partnerResults.filter(
          ({ partnerSubscription }) => partnerSubscription,
        ).length,
        legacyBillingFallbacks: partnerResults.filter(
          ({ partnerSubscription }) => !partnerSubscription,
        ).length,
        proposedInserts: subscriptions.length,
        candidatesWithWarnings: subscriptions.filter(
          ({ warnings }) => warnings.length > 0,
        ).length,
      },
      subscriptions,
    };
    const candidate = {
      ...candidateWithoutHash,
      approvalHash: candidateHash(candidateWithoutHash),
    };

    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    return candidate;
  } finally {
    await mongoClient.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const candidate = await createCandidate(options);
  console.log(JSON.stringify(candidate.summary, null, 2));
  console.log(`Approval hash: ${candidate.approvalHash}`);
  console.log(`Candidate: ${options.output}`);
  console.log("No MongoDB or Shopify records were changed.");
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
