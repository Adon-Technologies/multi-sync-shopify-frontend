import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient } from "mongodb";

import { parseCsv } from "./shopify-csv-store-transform.mjs";
import { isValidShopDomain, normalizeShopDomain } from "./store-transform.mjs";

const SOURCE_DATABASE = "gsf";
const TARGET_DATABASE = "Multi-sync";
const DEFAULT_OUTPUT = "scripts/migrate-database/configurations.candidate.json";
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const DEFAULT_COLOR_OPTIONS = ["Color", "Colour"];
const DEFAULT_SIZE_OPTIONS = ["Size"];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizedText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
    : "";
}

function normalizeOptionNames(value) {
  if (!Array.isArray(value)) return null;

  const seen = new Set();
  const names = [];
  for (const item of value) {
    const name = normalizedText(item).slice(0, 100);
    const comparable = name.toLocaleLowerCase();
    if (!name || seen.has(comparable)) continue;
    seen.add(comparable);
    names.push(name);
    if (names.length === 100) break;
  }
  return names;
}

function ensureRequiredOptionNames(value, requiredNames) {
  const requiredByKey = new Map(
    requiredNames.map((name) => [name.toLocaleLowerCase(), name]),
  );
  const normalized = normalizeOptionNames(value) ?? [];
  const seen = new Set();
  const names = [];

  for (const name of normalized) {
    const comparable = name.toLocaleLowerCase();
    const canonical = requiredByKey.get(comparable) ?? name;
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    names.push(canonical);
  }
  for (const name of requiredNames) {
    const comparable = name.toLocaleLowerCase();
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    names.push(name);
  }
  return names;
}

function legacyExcludedCollectionTitles(value) {
  if (!Array.isArray(value)) return null;
  return [
    ...new Set(
      value.map((title) => normalizedText(title).slice(0, 255)).filter(Boolean),
    ),
  ];
}

function diagnosticsRevision(colorOptions, sizeOptions) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ageRulesAppliedVersion: 0,
        colorOptions: [...colorOptions]
          .map((value) => normalizedText(value).toLocaleLowerCase())
          .sort(),
        sizeOptions: [...sizeOptions]
          .map((value) => normalizedText(value).toLocaleLowerCase())
          .sort(),
        excludedCollectionIds: [],
        excludedTitleTerms: [],
        genderRulesAppliedVersion: 0,
      }),
    )
    .digest("hex");
}

export function parseConfigurationCsv(text) {
  const rows = parseCsv(text);
  const requiredHeaders = ["Shop domain", "Shop email", "Shop country"];
  for (const header of requiredHeaders) {
    if (!rows[0] || !(header in rows[0])) {
      throw new Error(`CSV is missing required header: ${header}`);
    }
  }

  const shops = new Map();
  for (const [index, row] of rows.entries()) {
    const shopDomain = normalizeShopDomain(row["Shop domain"]);
    if (!isValidShopDomain(shopDomain)) {
      throw new Error(`CSV row ${index + 2} has an invalid Shop domain`);
    }
    if (shops.has(shopDomain)) {
      throw new Error(`CSV contains duplicate shop: ${shopDomain}`);
    }

    const alertsEmail = normalizedText(row["Shop email"]).toLowerCase();
    const countryCode = normalizedText(row["Shop country"]).toUpperCase();
    shops.set(shopDomain, {
      alertsEmail: EMAIL_ADDRESS.test(alertsEmail) ? alertsEmail : null,
      countryCode: COUNTRY_CODE.test(countryCode) ? countryCode : null,
    });
  }
  return shops;
}

export function buildConfigurationEntry({
  generatedAt,
  legacyStore,
  shop,
  storeId,
}) {
  const warnings = [];
  const alertsEmail = shop?.alertsEmail ?? "";
  const countryCode = shop?.countryCode ?? "";
  const legacyColorOptions = normalizeOptionNames(legacyStore?.colorOptionName);
  const legacySizeOptions = normalizeOptionNames(legacyStore?.sizeOptionName);
  const legacyExcludedTitles = legacyExcludedCollectionTitles(
    legacyStore?.excludedCollectionTitles,
  );
  const colorOptions = ensureRequiredOptionNames(
    legacyStore?.colorOptionName,
    DEFAULT_COLOR_OPTIONS,
  );
  const sizeOptions = ensureRequiredOptionNames(
    legacyStore?.sizeOptionName,
    DEFAULT_SIZE_OPTIONS,
  );

  if (!shop) {
    warnings.push(
      "Store is absent from the Shopify CSV; alertsEmail and countryCode use empty application fallbacks",
    );
  } else {
    if (!shop.alertsEmail) {
      warnings.push(
        "Shopify CSV has no valid email; alertsEmail uses the empty application fallback",
      );
    }
    if (!shop.countryCode) {
      warnings.push(
        "Shopify CSV has no valid country; countryCode uses the empty application fallback",
      );
    }
  }
  if (legacyExcludedTitles?.length) {
    warnings.push(
      "Legacy excludedCollectionTitles contains titles without Shopify collection IDs and cannot be inserted into the current excludedCollections field",
    );
  }

  return {
    action: "insert",
    sourceShopDomain: shop?.shopDomain,
    sources: {
      alertsEmail: shop?.alertsEmail ? "shopify_csv" : "application_default",
      countryCode: shop?.countryCode ? "shopify_csv" : "application_default",
      colorOptions:
        legacyColorOptions === null
          ? "application_defaults"
          : "gsf.Store.colorOptionName",
      sizeOptions:
        legacySizeOptions === null
          ? "application_defaults"
          : "gsf.Store.sizeOptionName",
      excludedCollections:
        legacyExcludedTitles === null
          ? "application_defaults"
          : "gsf.Store.excludedCollectionTitles",
      remainingFields: "application_defaults",
    },
    warnings,
    document: {
      storeId,
      alertsEmail,
      countryCode,
      colorOption: null,
      sizeOption: null,
      colorOptions,
      sizeOptions,
      optionMappingsInitialized: true,
      excludedCollections: [],
      excludedTitleTerms: [],
      diagnosticsRevision: diagnosticsRevision(colorOptions, sizeOptions),
      showSalePriceInGoogleFeed: false,
      useProductImageAsMainImage: false,
      includeShippingWeightInGoogleFeed: false,
      excludeOutOfStockItems: false,
      ignoreShopifyInventoryInGoogleFeed: false,
      inventorySourceMode: "ALL_LOCATIONS",
      selectedInventoryLocationIds: [],
      disableUtmParameters: false,
      disablePrimaryCurrencyParameter: false,
      checkoutLinkMode: "DISABLED",
      defaultGender: null,
      defaultAgeGroup: null,
      genderRules: null,
      ageRules: null,
      genderRulesVersion: 0,
      ageRulesVersion: 0,
      genderRulesAppliedVersion: 0,
      ageRulesAppliedVersion: 0,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    },
  };
}

function parseArguments(arguments_) {
  const options = {
    file: null,
    output: DEFAULT_OUTPUT,
  };
  for (const argument of arguments_) {
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: npm run migrate:configurations -- --file=PATH [--output=PATH]",
      );
      console.log("Read-only: performs no MongoDB writes or deletes.");
      process.exit(0);
    }
    if (argument.startsWith("--file=")) {
      options.file = argument.slice("--file=".length);
      continue;
    }
    if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.file) throw new Error("--file=PATH is required");
  return {
    file: resolve(options.file),
    output: resolve(options.output),
  };
}

export async function prepareConfigurations({
  csvPath,
  mongoUri = requiredEnvironment("DATABASE_URL"),
  outputPath,
}) {
  const generatedAt = new Date();
  const csvText = await readFile(csvPath, "utf8");
  const csvShops = parseConfigurationCsv(csvText);
  for (const [shopDomain, shop] of csvShops) {
    shop.shopDomain = shopDomain;
  }

  const client = new MongoClient(mongoUri, {
    readPreference: "secondaryPreferred",
  });
  try {
    await client.connect();
    const sourceDb = client.db(SOURCE_DATABASE);
    const targetDb = client.db(TARGET_DATABASE);
    const [
      legacyConfigurationCount,
      legacyStores,
      installedStores,
      targetConfigurations,
    ] = await Promise.all([
      sourceDb.collection("Configuration").countDocuments(),
      sourceDb
        .collection("Store")
        .find(
          {},
          {
            projection: {
              shopDomain: 1,
              colorOptionName: 1,
              excludedCollectionTitles: 1,
              sizeOptionName: 1,
            },
          },
        )
        .toArray(),
      targetDb
        .collection("Store")
        .find({ status: "INSTALLED" }, { projection: { shopDomain: 1 } })
        .sort({ shopDomain: 1 })
        .toArray(),
      targetDb
        .collection("Configuration")
        .find({}, { projection: { storeId: 1 } })
        .toArray(),
    ]);

    const legacyStoresByDomain = new Map(
      legacyStores.map((store) => [
        normalizeShopDomain(store.shopDomain),
        store,
      ]),
    );
    const configuredStoreIds = new Set(
      targetConfigurations.map(({ storeId }) => String(storeId)),
    );
    const existingConfigurations = installedStores
      .filter((store) => configuredStoreIds.has(String(store._id)))
      .map((store) => store.shopDomain)
      .sort();
    const configurations = installedStores
      .filter((store) => !configuredStoreIds.has(String(store._id)))
      .map((store) =>
        buildConfigurationEntry({
          generatedAt,
          legacyStore: legacyStoresByDomain.get(store.shopDomain),
          shop: csvShops.get(store.shopDomain) ?? {
            alertsEmail: null,
            countryCode: null,
            shopDomain: store.shopDomain,
          },
          storeId: String(store._id),
        }),
      );
    const installedDomains = new Set(
      installedStores.map(({ shopDomain }) => shopDomain),
    );
    const csvDomainsOutsideInstalledStores = [...csvShops.keys()]
      .filter((shopDomain) => !installedDomains.has(shopDomain))
      .sort();

    const candidate = {
      formatVersion: 1,
      candidateType: "ConfigurationBulkInsert",
      generatedAt,
      sourceFile: basename(csvPath),
      sourceCsvSha256: createHash("sha256").update(csvText).digest("hex"),
      sourceDatabase: SOURCE_DATABASE,
      targetDatabase: TARGET_DATABASE,
      policy: {
        installedStoresOnly: true,
        existingConfigurationsAreUnchanged: true,
        uninstalledStoresAreUnchanged: true,
        shopEmailAndCountryComeFromShopifyCsv: true,
        legacyStoreFieldsMigrated: [
          "colorOptionName -> colorOptions",
          "sizeOptionName -> sizeOptions",
          "excludedCollectionTitles -> excludedCollections when valid IDs and titles are available",
        ],
        requiredOptionNamesAdded: ["Color", "Colour", "Size"],
        allOtherLegacyStoreFieldsAreIgnored: true,
        remainingFieldsUseApplicationDefaults: true,
        updatesAllowed: false,
        deletesAllowed: false,
      },
      summary: {
        installedStores: installedStores.length,
        existingConfigurations: existingConfigurations.length,
        candidateConfigurations: configurations.length,
        legacyConfigurations: legacyConfigurationCount,
        legacyStores: legacyStores.length,
        candidatesUsingLegacyStoreFields: configurations.filter(
          ({ sources }) =>
            sources.colorOptions === "gsf.Store.colorOptionName" ||
            sources.sizeOptions === "gsf.Store.sizeOptionName" ||
            sources.excludedCollections ===
              "gsf.Store.excludedCollectionTitles",
        ).length,
        candidatesUsingOnlyDefaults: configurations.filter(
          ({ sources }) =>
            sources.colorOptions === "application_defaults" &&
            sources.sizeOptions === "application_defaults" &&
            sources.excludedCollections === "application_defaults",
        ).length,
        legacyStoresWithExcludedCollectionTitles: legacyStores.filter(
          ({ excludedCollectionTitles }) =>
            Array.isArray(excludedCollectionTitles) &&
            excludedCollectionTitles.length > 0,
        ).length,
        candidatesWithExcludedCollectionTitles: configurations.filter(
          ({ document }) => document.excludedCollections.length > 0,
        ).length,
        candidatesWithRequiredOptionNames: configurations.filter(
          ({ document }) =>
            document.colorOptions.includes("Color") &&
            document.colorOptions.includes("Colour") &&
            document.sizeOptions.includes("Size"),
        ).length,
        csvShops: csvShops.size,
        csvDomainsOutsideInstalledStores:
          csvDomainsOutsideInstalledStores.length,
        candidatesWithWarnings: configurations.filter(
          ({ warnings }) => warnings.length > 0,
        ).length,
        targetWrites: 0,
        updates: 0,
        deletes: 0,
      },
      existingConfigurationsSkipped: existingConfigurations,
      csvDomainsOutsideInstalledStores,
      configurations,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8",
    );
    return candidate;
  } finally {
    await client.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const candidate = await prepareConfigurations({
    csvPath: options.file,
    outputPath: options.output,
  });
  console.log(JSON.stringify(candidate.summary, null, 2));
  console.log(`Editable candidate: ${options.output}`);
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(
      `[Configuration preview] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
