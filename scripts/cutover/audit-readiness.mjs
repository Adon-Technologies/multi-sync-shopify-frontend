import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { MongoClient } from "mongodb";

const DEFAULT_BACKEND_ENV = "../multi-sync-backend/.env";
const DEFAULT_CONFIG = "shopify.app.multi-sync-google-feed.toml";
const DEFAULT_FRONTEND_ENV = ".env";
const DEFAULT_OUTPUT = "scripts/cutover/cutover-readiness.report.json";
const DEFAULT_REFERENCE_SHOPIFY_ENV =
  "../../Multi-Sync/multi-sync-frontend/.env";
const EXPECTED_APP_HANDLE = "multi-sync-google-feed";
const EXPECTED_APP_URL = "https://multi-sync.fly.dev";
const EXPECTED_BACKEND_URL =
  "https://multi-sync-server-392904571480.europe-west1.run.app";
const EXPECTED_BUCKET = "multi-sync";
const EXPECTED_DATABASE = "Multi-sync";
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function parseArguments(arguments_) {
  const options = {
    backendEnv: DEFAULT_BACKEND_ENV,
    config: DEFAULT_CONFIG,
    frontendEnv: DEFAULT_FRONTEND_ENV,
    output: DEFAULT_OUTPUT,
    referenceShopifyEnv: DEFAULT_REFERENCE_SHOPIFY_ENV,
    validateShopify: false,
  };

  for (const argument of arguments_) {
    if (argument === "--validate-shopify") {
      options.validateShopify = true;
    } else if (argument.startsWith("--backend-env=")) {
      options.backendEnv = argument.slice("--backend-env=".length);
    } else if (argument.startsWith("--config=")) {
      options.config = argument.slice("--config=".length);
    } else if (argument.startsWith("--frontend-env=")) {
      options.frontendEnv = argument.slice("--frontend-env=".length);
    } else if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
    } else if (argument.startsWith("--reference-shopify-env=")) {
      options.referenceShopifyEnv = argument.slice(
        "--reference-shopify-env=".length,
      );
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: npm run audit:cutover -- [options]

Options:
  --validate-shopify       Make read-only Admin API identity/scope checks
  --frontend-env=PATH      Frontend environment file (default: .env)
  --backend-env=PATH       Backend environment file
  --config=PATH            Cutover Shopify TOML file
  --reference-shopify-env  Existing app env used only for key/secret fingerprints
  --output=PATH            Local JSON report path

This command never modifies MongoDB, Shopify, GCS, or a deployed service.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      typeof value === "string" ? resolve(value) : value,
    ]),
  );
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readEnvironment(path) {
  const values = {};
  const content = await readFile(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    values[key] = unquote(line.slice(separator + 1));
  }
  return values;
}

function readTomlString(content, key) {
  const match = content.match(
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']\\s*$`, "m"),
  );
  return match?.[1]?.trim() ?? null;
}

function readTomlScopes(content) {
  const value = readTomlString(content, "scopes");
  return value
    ? value
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
        .sort()
    : [];
}

function databaseName(connectionString) {
  if (!connectionString) return null;
  const withoutQuery = connectionString.split("?", 1)[0];
  const slash = withoutQuery.lastIndexOf("/");
  if (slash < 0 || slash === withoutQuery.length - 1) return null;
  return decodeURIComponent(withoutQuery.slice(slash + 1));
}

function normalizeUrl(value) {
  return value?.trim().replace(/\/+$/, "") || null;
}

function fingerprint(value) {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : null;
}

function check(name, actual, expected, severity = "ERROR") {
  const passed = actual === expected;
  return {
    actual:
      typeof actual === "string" &&
      (name.toLowerCase().includes("secret") ||
        name.toLowerCase().includes("key"))
        ? fingerprint(actual)
        : actual,
    expected:
      typeof expected === "string" &&
      (name.toLowerCase().includes("secret") ||
        name.toLowerCase().includes("key"))
        ? fingerprint(expected)
        : expected,
    name,
    passed,
    severity: passed ? "OK" : severity,
  };
}

function normalizeShop(value) {
  const shop =
    typeof value === "string"
      ? value.normalize("NFKC").trim().toLowerCase()
      : "";
  return SHOP_PATTERN.test(shop) ? shop : null;
}

function countBy(rows, key) {
  return Object.fromEntries(
    rows.map((row) => [String(row._id ?? "null"), row[key]]),
  );
}

async function aggregateCount(collection, groupField) {
  return collection
    .aggregate([
      { $group: { _id: `$${groupField}`, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
}

async function inspectDatabase(connectionString) {
  const client = new MongoClient(connectionString);
  await client.connect();

  try {
    const database = client.db(EXPECTED_DATABASE);
    const storesCollection = database.collection("Store");
    const stores = await storesCollection
      .find(
        {},
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
          },
        },
      )
      .sort({ shopDomain: 1 })
      .toArray();

    const installed = stores.filter(({ status }) => status === "INSTALLED");
    const activeInstalled = installed.filter(
      ({ accessStatus }) => accessStatus === "ACTIVE",
    );
    const tokenClasses = {
      expiring: [],
      incompleteExpiring: [],
      legacyNonExpiring: [],
      missing: [],
    };

    for (const store of installed) {
      const shop = normalizeShop(store.shopDomain) ?? String(store.shopDomain);
      if (!store.accessToken) {
        tokenClasses.missing.push(shop);
      } else if (
        store.accessTokenExpiresAt &&
        store.refreshToken &&
        store.refreshTokenExpiresAt
      ) {
        tokenClasses.expiring.push(shop);
      } else if (
        !store.accessTokenExpiresAt &&
        !store.refreshToken &&
        !store.refreshTokenExpiresAt
      ) {
        tokenClasses.legacyNonExpiring.push(shop);
      } else {
        tokenClasses.incompleteExpiring.push(shop);
      }
    }

    const installedIds = activeInstalled.map(({ _id }) => _id);
    const installedDomains = activeInstalled.map(({ shopDomain }) => shopDomain);
    const [
      configurationStoreIds,
      subscriptionStoreIds,
      scheduleStoreIds,
      xmlStoreIds,
      configurationCount,
      subscriptionCount,
      scheduleCount,
      xmlCount,
      sessionCount,
      subscriptionStatuses,
      xmlStatuses,
      xmlTypes,
      dueSchedules,
    ] = await Promise.all([
      database
        .collection("Configuration")
        .distinct("storeId", { storeId: { $in: installedIds } }),
      database
        .collection("StoreSubscription")
        .distinct("storeId", { storeId: { $in: installedIds } }),
      database
        .collection("FeedRefreshSchedule")
        .distinct("storeId", { storeId: { $in: installedIds } }),
      database
        .collection("XmlLink")
        .distinct("storeId", { storeId: { $in: installedIds } }),
      database.collection("Configuration").countDocuments(),
      database.collection("StoreSubscription").countDocuments(),
      database.collection("FeedRefreshSchedule").countDocuments(),
      database.collection("XmlLink").countDocuments(),
      database.collection("shopify_sessions").countDocuments(),
      aggregateCount(
        database.collection("StoreSubscription"),
        "status",
      ),
      aggregateCount(database.collection("XmlLink"), "status"),
      aggregateCount(database.collection("XmlLink"), "feedType"),
      database
        .collection("FeedRefreshSchedule")
        .countDocuments({ nextRunAt: { $lte: new Date() } }),
    ]);

    function missingDomains(foundIds) {
      const found = new Set(foundIds.map(String));
      return activeInstalled
        .filter(({ _id }) => !found.has(String(_id)))
        .map(({ shopDomain }) => shopDomain);
    }

    const invalidXmlLocations = await database
      .collection("XmlLink")
      .aggregate([
        {
          $lookup: {
            from: "Store",
            localField: "storeId",
            foreignField: "_id",
            as: "store",
          },
        },
        { $unwind: "$store" },
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ["$gcsObjectName", null] },
                {
                  $not: {
                    $regexMatch: {
                      input: "$gcsObjectName",
                      regex: {
                        $concat: ["^feeds/", "$store.shopDomain", "/"],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        { $project: { _id: 0, shopDomain: "$store.shopDomain" } },
      ])
      .toArray();

    return {
      collections: {
        configurations: configurationCount,
        feedRefreshSchedules: scheduleCount,
        shopifySessions: sessionCount,
        storeSubscriptions: subscriptionCount,
        xmlLinks: xmlCount,
      },
      cron: {
        dueSchedules,
        missingSchedulesForActiveInstalledStores:
          missingDomains(scheduleStoreIds),
        note:
          "The dispatcher creates missing default schedules before claiming due work.",
      },
      installedActiveStoreCoverage: {
        missingConfigurations: missingDomains(configurationStoreIds),
        missingSubscriptions: missingDomains(subscriptionStoreIds),
        missingXmlLinks: missingDomains(xmlStoreIds),
        stores: installedDomains.length,
      },
      subscriptions: {
        byStatus: countBy(subscriptionStatuses, "count"),
      },
      stores: {
        activeInstalled: activeInstalled.length,
        byAccessStatus: countBy(
          await aggregateCount(storesCollection, "accessStatus"),
          "count",
        ),
        byStatus: countBy(
          await aggregateCount(storesCollection, "status"),
          "count",
        ),
        installed: installed.length,
        tokens: Object.fromEntries(
          Object.entries(tokenClasses).map(([key, domains]) => [
            key,
            { count: domains.length, domains },
          ]),
        ),
        total: stores.length,
      },
      xmlLinks: {
        byStatus: countBy(xmlStatuses, "count"),
        byType: countBy(xmlTypes, "count"),
        invalidGcsObjectPrefixes: invalidXmlLocations.map(
          ({ shopDomain }) => shopDomain,
        ),
      },
      _shopifyCandidates: installed
        .filter(({ accessToken }) => accessToken)
        .map(({ accessToken, shopDomain }) => ({
          accessToken,
          shopDomain,
        })),
    };
  } finally {
    await client.close();
  }
}

function wait(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function queryShopify(candidate, apiVersion, requiredScopes) {
  const endpoint = `https://${candidate.shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const query = `#graphql
    query MultiSyncCutoverReadiness {
      app {
        handle
        id
      }
      shop {
        myshopifyDomain
      }
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }
  `;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": candidate.accessToken,
        },
        body: JSON.stringify({ query }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await wait(
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.min(retryAfter * 1_000, 10_000)
            : 500 * 2 ** attempt,
        );
        continue;
      }

      const returnedShop = normalizeShop(payload?.data?.shop?.myshopifyDomain);
      const appId =
        typeof payload?.data?.app?.id === "string"
          ? payload.data.app.id
          : null;
      const appHandle =
        typeof payload?.data?.app?.handle === "string"
          ? payload.data.app.handle
          : null;
      const installation =
        payload?.data?.currentAppInstallation ?? null;
      const grantedScopes = new Set(
        (installation?.accessScopes ?? [])
          .map(({ handle }) => handle)
          .filter(Boolean),
      );
      const missingScopes = installation
        ? requiredScopes.filter((scope) => !grantedScopes.has(scope))
        : [];
      return {
        appHandle,
        appId,
        httpStatus: response.status,
        identityMatches: returnedShop === candidate.shopDomain,
        missingScopes,
        ok:
          response.ok &&
          !payload?.errors?.length &&
          returnedShop === candidate.shopDomain,
        shopDomain: candidate.shopDomain,
      };
    } catch (error) {
      if (attempt === 2) {
        return {
          error: error instanceof Error ? error.name : "UNKNOWN",
          httpStatus: null,
          identityMatches: false,
          missingScopes: [],
          ok: false,
          shopDomain: candidate.shopDomain,
        };
      }
      await wait(500 * 2 ** attempt);
    }
  }
}

async function validateShopify(candidates, apiVersion, requiredScopes) {
  const results = [];
  for (let index = 0; index < candidates.length; index += 5) {
    results.push(
      ...(await Promise.all(
        candidates
          .slice(index, index + 5)
          .map((candidate) =>
            queryShopify(candidate, apiVersion, requiredScopes),
          ),
      )),
    );
  }
  const appIdentities = [
    ...new Map(
      results
        .filter(({ ok, appId }) => ok && appId)
        .map(({ appHandle, appId }) => [
          `${appId}\u0000${appHandle ?? ""}`,
          { appHandle, appId },
        ]),
    ).values(),
  ];
  return {
    accessible: results.filter(({ ok }) => ok).length,
    appIdentities,
    authorizationFailed: results
      .filter(({ httpStatus }) => httpStatus === 401)
      .map(({ shopDomain }) => shopDomain),
    checked: results.length,
    failed: results.filter(({ ok }) => !ok),
    scopeUpdatesRequired: results
      .filter(({ missingScopes }) => missingScopes.length > 0)
      .map(({ missingScopes, shopDomain }) => ({
        missingScopes,
        shopDomain,
      })),
  };
}

function withoutTokens(databaseInspection) {
  const { _shopifyCandidates, ...safe } = databaseInspection;
  return safe;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [
    frontendEnv,
    backendEnv,
    referenceShopifyEnv,
    configToml,
    flyToml,
  ] = await Promise.all([
    readEnvironment(options.frontendEnv),
    readEnvironment(options.backendEnv),
    readEnvironment(options.referenceShopifyEnv).catch(() => null),
    readFile(options.config, "utf8"),
    readFile(resolve("fly.toml"), "utf8"),
  ]);
  const config = {
    apiVersion:
      configToml.match(/^\s*api_version\s*=\s*["']([^"']+)["']/m)?.[1] ??
      null,
    appUrl: readTomlString(configToml, "application_url"),
    clientId: readTomlString(configToml, "client_id"),
    handle: readTomlString(configToml, "handle"),
    name: readTomlString(configToml, "name"),
    scopes: readTomlScopes(configToml),
  };
  const flyBackendUrl =
    flyToml.match(
      /^\s*MULTI_SYNC_BACKEND_URL\s*=\s*["']([^"']+)["']/m,
    )?.[1] ?? null;
  const checks = [
    check("cutover app handle", config.handle, EXPECTED_APP_HANDLE),
    check("cutover app URL", normalizeUrl(config.appUrl), EXPECTED_APP_URL),
    check(
      "frontend database",
      databaseName(frontendEnv.DATABASE_URL),
      EXPECTED_DATABASE,
    ),
    check(
      "backend database",
      databaseName(backendEnv.DATABASE_URL),
      EXPECTED_DATABASE,
    ),
    check("backend GCS bucket", backendEnv.GCS_BUCKET_NAME, EXPECTED_BUCKET),
    check(
      "Fly backend URL",
      normalizeUrl(flyBackendUrl),
      EXPECTED_BACKEND_URL,
    ),
    check(
      "frontend app URL environment",
      normalizeUrl(frontendEnv.SHOPIFY_APP_URL),
      EXPECTED_APP_URL,
    ),
    check(
      "frontend Shopify API key",
      frontendEnv.SHOPIFY_API_KEY,
      config.clientId,
    ),
    check(
      "backend Shopify API key",
      backendEnv.SHOPIFY_API_KEY,
      config.clientId,
    ),
    check(
      "frontend/backend Shopify API secret",
      frontendEnv.SHOPIFY_API_SECRET,
      backendEnv.SHOPIFY_API_SECRET,
    ),
    check(
      "frontend/backend internal secret",
      frontendEnv.MULTI_SYNC_INTERNAL_SECRET,
      backendEnv.MULTI_SYNC_INTERNAL_SECRET,
    ),
    check(
      "backend Shopify app handle",
      backendEnv.SHOPIFY_APP_HANDLE,
      EXPECTED_APP_HANDLE,
    ),
    check(
      "backend Shopify API version",
      backendEnv.SHOPIFY_API_VERSION,
      config.apiVersion,
    ),
  ];
  if (referenceShopifyEnv) {
    checks.push(
      check(
        "reference Shopify API key",
        referenceShopifyEnv.SHOPIFY_API_KEY,
        config.clientId,
      ),
      check(
        "frontend target Shopify API secret",
        frontendEnv.SHOPIFY_API_SECRET,
        referenceShopifyEnv.SHOPIFY_API_SECRET,
      ),
      check(
        "backend target Shopify API secret",
        backendEnv.SHOPIFY_API_SECRET,
        referenceShopifyEnv.SHOPIFY_API_SECRET,
      ),
    );
  } else {
    checks.push({
      actual: "<missing>",
      expected: "<readable reference env>",
      name: "target Shopify secret reference",
      passed: false,
      severity: "ERROR",
    });
  }

  for (const [name, value] of [
    ["backend Shopify app ID configured", backendEnv.SHOPIFY_APP_ID],
    ["backend Partner organization ID", backendEnv.SHOPIFY_PARTNER_ORG_ID],
    ["backend Partner access token", backendEnv.SHOPIFY_PARTNER_ACCESS_TOKEN],
  ]) {
    checks.push({
      actual: value ? "<configured>" : "<missing>",
      expected: "<configured>",
      name,
      passed: Boolean(value),
      severity: value ? "OK" : "ERROR",
    });
  }

  const databaseInspection = await inspectDatabase(frontendEnv.DATABASE_URL);
  const tokenSummary = databaseInspection.stores.tokens;
  checks.push({
    actual: tokenSummary.missing.count,
    expected: 0,
    name: "installed stores missing access tokens",
    passed: tokenSummary.missing.count === 0,
    severity: tokenSummary.missing.count === 0 ? "OK" : "ERROR",
  });
  checks.push({
    actual: tokenSummary.incompleteExpiring.count,
    expected: 0,
    name: "installed stores with incomplete expiring-token fields",
    passed: tokenSummary.incompleteExpiring.count === 0,
    severity:
      tokenSummary.incompleteExpiring.count === 0 ? "OK" : "ERROR",
  });

  const shopify = options.validateShopify
    ? await validateShopify(
        databaseInspection._shopifyCandidates,
        config.apiVersion,
        config.scopes,
      )
    : {
        checked: 0,
        note:
          "Not run. Use npm run audit:cutover:shopify for read-only live token and scope checks.",
      };
  if (options.validateShopify) {
    checks.push({
      actual: shopify.failed.length,
      expected: 0,
      name: "live Shopify token validation failures",
      passed: shopify.failed.length === 0,
      severity: shopify.failed.length === 0 ? "OK" : "ERROR",
    });
    checks.push({
      actual: shopify.scopeUpdatesRequired.length,
      expected: 0,
      name: "stores missing required Shopify scopes",
      passed: shopify.scopeUpdatesRequired.length === 0,
      severity:
        shopify.scopeUpdatesRequired.length === 0 ? "OK" : "ERROR",
    });
    const liveApp =
      shopify.appIdentities.length === 1
        ? shopify.appIdentities[0]
        : null;
    checks.push({
      actual: shopify.appIdentities.length,
      expected: 1,
      name: "unique Shopify app identity across valid legacy tokens",
      passed: shopify.appIdentities.length === 1,
      severity:
        shopify.appIdentities.length === 1 ? "OK" : "ERROR",
    });
    checks.push(
      check(
        "live legacy-token Shopify app handle",
        liveApp?.appHandle ?? null,
        EXPECTED_APP_HANDLE,
      ),
    );
    const configuredAppId = backendEnv.SHOPIFY_APP_ID?.startsWith("gid://")
      ? backendEnv.SHOPIFY_APP_ID
      : backendEnv.SHOPIFY_APP_ID
        ? `gid://shopify/App/${backendEnv.SHOPIFY_APP_ID}`
        : null;
    checks.push(
      check(
        "backend Shopify app ID",
        configuredAppId,
        liveApp?.appId ?? null,
      ),
    );
  }

  const failedChecks = checks.filter(({ passed }) => !passed);
  const warnings = [];
  const coverage = databaseInspection.installedActiveStoreCoverage;
  if (coverage.missingSubscriptions.length > 0) {
    warnings.push(
      `${coverage.missingSubscriptions.length} active installed stores have no StoreSubscription and won't pass the billing gate.`,
    );
  }
  if (coverage.missingXmlLinks.length > 0) {
    warnings.push(
      `${coverage.missingXmlLinks.length} active installed stores have no XmlLink to refresh.`,
    );
  }
  if (
    databaseInspection.cron.missingSchedulesForActiveInstalledStores.length >
    0
  ) {
    warnings.push(
      `${databaseInspection.cron.missingSchedulesForActiveInstalledStores.length} schedules are absent; the first dispatcher call will create them.`,
    );
  }
  if (databaseInspection.collections.shopifySessions === 0) {
    warnings.push(
      "shopify_sessions is empty. This is acceptable before cutover; sessions are recreated when merchants open the app.",
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.validateShopify
      ? "READ_ONLY_WITH_SHOPIFY_VALIDATION"
      : "READ_ONLY_LOCAL_AND_MONGODB",
    verdict: failedChecks.length === 0 ? "READY" : "NOT_READY",
    checks,
    blockers: failedChecks.map(({ actual, expected, name }) => ({
      actual,
      expected,
      name,
    })),
    warnings,
    config: {
      apiVersion: config.apiVersion,
      appUrl: config.appUrl,
      clientIdFingerprint: fingerprint(config.clientId),
      handle: config.handle,
      name: config.name,
      scopes: config.scopes,
    },
    database: withoutTokens(databaseInspection),
    shopify,
  };

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        blockers: report.blockers,
        database: {
          activeInstalledStores:
            report.database.stores.activeInstalled,
          configurations: report.database.collections.configurations,
          feedRefreshSchedules:
            report.database.collections.feedRefreshSchedules,
          installedStores: report.database.stores.installed,
          shopifySessions: report.database.collections.shopifySessions,
          storeSubscriptions:
            report.database.collections.storeSubscriptions,
          tokenClasses: Object.fromEntries(
            Object.entries(report.database.stores.tokens).map(
              ([key, value]) => [key, value.count],
            ),
          ),
          totalStores: report.database.stores.total,
          xmlLinks: report.database.collections.xmlLinks,
        },
        mode: report.mode,
        output: options.output,
        verdict: report.verdict,
        warnings: report.warnings,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    `[cutover-audit] ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
