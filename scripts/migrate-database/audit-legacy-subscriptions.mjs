import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient } from "mongodb";

const SOURCE_DATABASE = "gsf";
const TARGET_DATABASE = "Multi-sync";
const DEFAULT_OUTPUT = "scripts/migrate-database/subscriptions.audit.json";
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SUBSCRIPTION_QUERY = `#graphql
  query SubscriptionMigrationAudit {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
      }
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
  let output = DEFAULT_OUTPUT;
  for (const argument of arguments_) {
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: npm run audit:legacy-subscriptions -- [--output=PATH]",
      );
      console.log(
        "Read-only: queries MongoDB and Shopify but performs no writes except the local audit file.",
      );
      process.exit(0);
    }
    if (argument.startsWith("--output=")) {
      output = argument.slice("--output=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { output: resolve(output) };
}

function wait(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function queryActiveSubscriptions(store, apiVersion) {
  if (!store?.accessToken) {
    return {
      error: "No legacy access token is available",
      status: "NO_TOKEN",
      subscriptions: [],
    };
  }

  const endpoint = `https://${store.shopDomain}/admin/api/${apiVersion}/graphql.json`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.accessToken,
        },
        body: JSON.stringify({ query: SUBSCRIPTION_QUERY }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      const errors = Array.isArray(payload.errors)
        ? payload.errors.map(({ message }) => String(message)).filter(Boolean)
        : [];
      if (response.ok && errors.length === 0) {
        return {
          error: null,
          status: "SUCCESS",
          subscriptions:
            payload.data?.currentAppInstallation?.activeSubscriptions ?? [],
        };
      }

      lastError =
        errors.join("; ") || `Shopify returned HTTP ${response.status}`;
      if (
        response.status !== 429 &&
        (response.status < 500 || response.status >= 600)
      ) {
        break;
      }
      const retryAfter = Number(response.headers.get("Retry-After"));
      await wait(
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.min(retryAfter * 1_000, 10_000)
          : 500 * 2 ** attempt,
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await wait(500 * 2 ** attempt);
    }
  }
  return {
    error: lastError ?? "Shopify subscription query failed",
    status: "FAILED",
    subscriptions: [],
  };
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

function trialSnapshot(trial) {
  if (!trial) return null;
  const total = Number.isFinite(trial.trialDaysTotal)
    ? Math.max(0, Math.floor(trial.trialDaysTotal))
    : 0;
  const consumed = Number.isFinite(trial.trialConsumed)
    ? Math.max(0, Math.floor(trial.trialConsumed))
    : 0;
  return {
    firstInstallAt: trial.firstInstallAt ?? null,
    lastUninstallAt: trial.lastUninstallAt ?? null,
    permanentlyLocked: trial.permanentlyLocked === true,
    trialCompleted: trial.trialCompleted === true,
    trialConsumed: consumed,
    trialDaysRemaining: Math.max(0, total - consumed),
    trialDaysTotal: total,
  };
}

function subscriptionTrialEndsAt(subscription) {
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

function classify(record, now) {
  if (record.legacyInstalled === false) return "UNINSTALLED";

  const realSubscriptions = record.shopify.subscriptions.filter(
    ({ status, test }) => status === "ACTIVE" && test !== true,
  );
  if (realSubscriptions.length > 0) {
    const stillTrialing = realSubscriptions.some((subscription) => {
      const trialEndsAt = subscriptionTrialEndsAt(subscription);
      return trialEndsAt && trialEndsAt.getTime() > now.getTime();
    });
    return stillTrialing ? "TRIAL" : "SUBSCRIBER";
  }
  const testSubscriptions = record.shopify.subscriptions.filter(
    ({ status, test }) => status === "ACTIVE" && test === true,
  );
  if (testSubscriptions.length > 0) return "TEST_SUBSCRIPTION";

  if (
    record.trial &&
    !record.trial.trialCompleted &&
    !record.trial.permanentlyLocked &&
    record.trial.trialDaysRemaining > 0
  ) {
    return "TRIAL";
  }
  if (record.legacyInstalled !== true) return "MISSING_INSTALL_STATUS";
  if (record.shopify.queryStatus === "SUCCESS") {
    return "INSTALLED_NO_SUBSCRIPTION";
  }
  return "INSTALLED_SUBSCRIPTION_UNKNOWN";
}

function countBy(records, selector) {
  return Object.fromEntries(
    [
      ...records.reduce((counts, record) => {
        const key = String(selector(record) ?? "null");
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map()),
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export async function createSubscriptionAudit({
  mongoUri = requiredEnvironment("DATABASE_URL"),
  outputPath,
}) {
  const generatedAt = new Date();
  const client = new MongoClient(mongoUri, {
    readPreference: "secondaryPreferred",
  });
  try {
    await client.connect();
    const source = client.db(SOURCE_DATABASE);
    const target = client.db(TARGET_DATABASE);
    const [
      installerShops,
      trials,
      legacyStores,
      accessRecords,
      installEvents,
      billingSettings,
      targetStores,
      targetSubscriptions,
    ] = await Promise.all([
      source.collection("InstallerShop").find({}).toArray(),
      source.collection("ShopTrial").find({}).toArray(),
      source
        .collection("Store")
        .find({}, { projection: { shopDomain: 1, accessToken: 1 } })
        .toArray(),
      source.collection("ShopAccess").find({}).toArray(),
      source.collection("InstallEvent").find({}).toArray(),
      source.collection("BillingPlanSettings").find({}).toArray(),
      target
        .collection("Store")
        .find(
          {},
          {
            projection: {
              accessToken: 1,
              shopDomain: 1,
              shopPlan: 1,
              status: 1,
            },
          },
        )
        .toArray(),
      target.collection("StoreSubscription").find({}).toArray(),
    ]);

    const installerByShop = new Map(
      installerShops.map((record) => [normalizeShop(record.shop), record]),
    );
    const trialByShop = new Map(
      trials.map((record) => [normalizeShop(record._id), record]),
    );
    const legacyStoreByShop = new Map(
      legacyStores.map((record) => [normalizeShop(record.shopDomain), record]),
    );
    const accessByShop = new Map(
      accessRecords.map((record) => [normalizeShop(record.shop), record]),
    );
    const targetStoreByShop = new Map(
      targetStores.map((record) => [normalizeShop(record.shopDomain), record]),
    );
    const targetSubscriptionByStoreId = new Map(
      targetSubscriptions.map((record) => [String(record.storeId), record]),
    );
    const latestEventByShop = new Map();
    for (const event of installEvents) {
      const shop = normalizeShop(event.shop);
      const current = latestEventByShop.get(shop);
      if (
        shop &&
        (!current ||
          new Date(event.createdAt).getTime() >
            new Date(current.createdAt).getTime())
      ) {
        latestEventByShop.set(shop, event);
      }
    }

    const subscriptionQueryableStores = legacyStores
      .filter(
        ({ shopDomain }) =>
          installerByShop.get(normalizeShop(shopDomain))?.installed !== false,
      )
      .sort((left, right) => left.shopDomain.localeCompare(right.shopDomain));
    const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || "2026-07";
    const queriedSubscriptions = await mapWithConcurrency(
      subscriptionQueryableStores,
      4,
      (store) => queryActiveSubscriptions(store, apiVersion),
    );
    const shopifyByShop = new Map(
      subscriptionQueryableStores.map((store, index) => [
        normalizeShop(store.shopDomain),
        queriedSubscriptions[index],
      ]),
    );

    const domains = new Set([
      ...installerByShop.keys(),
      ...trialByShop.keys(),
      ...legacyStoreByShop.keys(),
    ]);
    const records = [...domains]
      .filter(Boolean)
      .sort()
      .map((shopDomain) => {
        const installer = installerByShop.get(shopDomain);
        const trial = trialSnapshot(trialByShop.get(shopDomain));
        const targetStore = targetStoreByShop.get(shopDomain);
        const targetSubscription = targetStore
          ? targetSubscriptionByStoreId.get(String(targetStore._id))
          : null;
        const shopify = shopifyByShop.get(shopDomain) ?? {
          error: null,
          status:
            installer?.installed === true
              ? "NOT_QUERIED_NO_STORE_DOCUMENT"
              : "NOT_QUERIED_UNINSTALLED",
          subscriptions: [],
        };
        const record = {
          shopDomain,
          classification: null,
          legacyInstalled:
            typeof installer?.installed === "boolean"
              ? installer.installed
              : null,
          legacyStoreDocument: legacyStoreByShop.has(shopDomain),
          legacyAccessSuspended:
            accessByShop.get(shopDomain)?.suspended ?? null,
          firstInstallAt: installer?.firstInstallAt ?? null,
          lastInstallAt: installer?.lastInstallAt ?? null,
          lastUninstallAt: installer?.lastUninstallAt ?? null,
          latestInstallEvent: latestEventByShop.has(shopDomain)
            ? {
                at: latestEventByShop.get(shopDomain).createdAt,
                type: latestEventByShop.get(shopDomain).type,
              }
            : null,
          trial,
          shopify: {
            queryError: shopify.error,
            queryStatus: shopify.status,
            subscriptions: shopify.subscriptions.map((subscription) => ({
              createdAt: subscription.createdAt ?? null,
              currentPeriodEnd: subscription.currentPeriodEnd ?? null,
              id: subscription.id,
              name: subscription.name,
              status: subscription.status,
              test: subscription.test === true,
              trialDays: Number(subscription.trialDays) || 0,
              trialEndsAt:
                subscriptionTrialEndsAt(subscription)?.toISOString() ?? null,
            })),
          },
          multiSync: targetStore
            ? {
                shopPlan: targetStore.shopPlan ?? null,
                status: targetStore.status,
                storeId: String(targetStore._id),
                subscription: targetSubscription
                  ? {
                      billingPeriod: targetSubscription.billingPeriod ?? null,
                      planHandle: targetSubscription.planHandle ?? null,
                      status: targetSubscription.status,
                      trialEndsAt: targetSubscription.trialEndsAt ?? null,
                    }
                  : null,
              }
            : null,
        };
        record.classification = classify(record, generatedAt);
        return record;
      });

    const legacyDomains = new Set(records.map(({ shopDomain }) => shopDomain));
    const targetDomains = new Set(targetStoreByShop.keys());
    const legacyInstalledDomains = new Set(
      records
        .filter(({ legacyInstalled }) => legacyInstalled === true)
        .map(({ shopDomain }) => shopDomain),
    );
    const targetInstalledDomains = new Set(
      targetStores
        .filter(({ status }) => status === "INSTALLED")
        .map(({ shopDomain }) => normalizeShop(shopDomain)),
    );
    const missingTrialRecords = [...installerByShop.keys()]
      .filter((shop) => !trialByShop.has(shop))
      .sort();
    const orphanTrialRecords = [...trialByShop.keys()]
      .filter((shop) => !installerByShop.has(shop))
      .sort();
    const installerEventMismatches = records
      .filter(
        ({ latestInstallEvent, legacyInstalled }) =>
          latestInstallEvent &&
          legacyInstalled !== null &&
          (latestInstallEvent.type === "INSTALL") !== legacyInstalled,
      )
      .map(({ shopDomain }) => shopDomain);

    const audit = {
      formatVersion: 1,
      auditType: "LegacySubscriptionReadOnly",
      generatedAt,
      sourceDatabase: SOURCE_DATABASE,
      targetDatabase: TARGET_DATABASE,
      policy: {
        mongoWrites: 0,
        shopifyWrites: 0,
        classificationUsesLiveReadOnlyShopifySubscriptionsWhenAvailable: true,
        noSubscriberIsInferredFromShopTrialAlone: true,
      },
      billingSettings: billingSettings.map((settings) => ({
        annualAmount: settings.annualAmount,
        annualEnabled: settings.annualEnabled,
        annualPlanKey: settings.annualPlanKey,
        currencyCode: settings.currencyCode,
        defaultTrialDays: settings.defaultTrialDays,
        monthlyAmount: settings.monthlyAmount,
        monthlyEnabled: settings.monthlyEnabled,
        monthlyPlanKey: settings.monthlyPlanKey,
      })),
      summary: {
        legacyInstallerShops: installerShops.length,
        legacyInstalled: records.filter(
          ({ legacyInstalled }) => legacyInstalled === true,
        ).length,
        legacyUninstalled: records.filter(
          ({ legacyInstalled }) => legacyInstalled === false,
        ).length,
        legacyStoreDocuments: legacyStores.length,
        legacyTrialRecords: trials.length,
        classifications: countBy(
          records,
          ({ classification }) => classification,
        ),
        shopifyQueryStatuses: countBy(
          records.filter(({ legacyInstalled }) => legacyInstalled === true),
          ({ shopify }) => shopify.queryStatus,
        ),
        realActiveSubscriptions: records.filter(({ shopify }) =>
          shopify.subscriptions.some(
            ({ status, test }) => status === "ACTIVE" && !test,
          ),
        ).length,
        testActiveSubscriptions: records.filter(({ shopify }) =>
          shopify.subscriptions.some(
            ({ status, test }) => status === "ACTIVE" && test,
          ),
        ).length,
        targetStores: targetStores.length,
        targetInstalled: targetStores.filter(
          ({ status }) => status === "INSTALLED",
        ).length,
        targetUninstalled: targetStores.filter(
          ({ status }) => status === "UNINSTALLED",
        ).length,
        targetSubscriptionRecords: targetSubscriptions.length,
        mongoWrites: 0,
        shopifyWrites: 0,
      },
      differences: {
        installerShopsMissingTrial: missingTrialRecords,
        trialRecordsMissingInstallerShop: orphanTrialRecords,
        latestInstallEventDisagreesWithInstallerShop: installerEventMismatches,
        legacyShopsMissingFromMultiSync: [...legacyDomains]
          .filter((shop) => !targetDomains.has(shop))
          .sort(),
        multiSyncShopsMissingFromLegacy: [...targetDomains]
          .filter((shop) => !legacyDomains.has(shop))
          .sort(),
        legacyInstalledMissingFromMultiSyncInstalled: [
          ...legacyInstalledDomains,
        ]
          .filter((shop) => !targetInstalledDomains.has(shop))
          .sort(),
        multiSyncInstalledMissingFromLegacyInstalled: [
          ...targetInstalledDomains,
        ]
          .filter((shop) => !legacyInstalledDomains.has(shop))
          .sort(),
      },
      records,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    return audit;
  } finally {
    await client.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const audit = await createSubscriptionAudit({
    outputPath: options.output,
  });
  console.log(JSON.stringify(audit.summary, null, 2));
  console.log(
    JSON.stringify(
      {
        installerShopsMissingTrial:
          audit.differences.installerShopsMissingTrial,
        legacyShopsMissingFromMultiSync:
          audit.differences.legacyShopsMissingFromMultiSync.length,
        multiSyncShopsMissingFromLegacy:
          audit.differences.multiSyncShopsMissingFromLegacy.length,
      },
      null,
      2,
    ),
  );
  console.log(`Detailed audit: ${options.output}`);
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(
      `[Legacy subscription audit] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
