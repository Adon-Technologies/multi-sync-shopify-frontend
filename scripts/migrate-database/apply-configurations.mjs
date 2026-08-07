import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient, ObjectId } from "mongodb";

const TARGET_DATABASE = "Multi-sync";
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const REVISION = /^[a-f0-9]{64}$/;
const DOCUMENT_FIELDS = new Set([
  "storeId",
  "alertsEmail",
  "countryCode",
  "colorOption",
  "sizeOption",
  "colorOptions",
  "sizeOptions",
  "optionMappingsInitialized",
  "excludedCollections",
  "excludedTitleTerms",
  "diagnosticsRevision",
  "showSalePriceInGoogleFeed",
  "useProductImageAsMainImage",
  "includeShippingWeightInGoogleFeed",
  "excludeOutOfStockItems",
  "ignoreShopifyInventoryInGoogleFeed",
  "inventorySourceMode",
  "selectedInventoryLocationIds",
  "disableUtmParameters",
  "disablePrimaryCurrencyParameter",
  "checkoutLinkMode",
  "defaultGender",
  "defaultAgeGroup",
  "genderRules",
  "ageRules",
  "genderRulesVersion",
  "ageRulesVersion",
  "genderRulesAppliedVersion",
  "ageRulesAppliedVersion",
  "createdAt",
  "updatedAt",
]);
const BOOLEAN_FIELDS = [
  "optionMappingsInitialized",
  "showSalePriceInGoogleFeed",
  "useProductImageAsMainImage",
  "includeShippingWeightInGoogleFeed",
  "excludeOutOfStockItems",
  "ignoreShopifyInventoryInGoogleFeed",
  "disableUtmParameters",
  "disablePrimaryCurrencyParameter",
];
const VERSION_FIELDS = [
  "genderRulesVersion",
  "ageRulesVersion",
  "genderRulesAppliedVersion",
  "ageRulesAppliedVersion",
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArguments(arguments_) {
  const options = { confirmTarget: null, execute: false, file: null };
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
  if (options.confirmTarget !== TARGET_DATABASE) {
    throw new Error(`Execution requires --confirm-target=${TARGET_DATABASE}`);
  }
  return options;
}

function stringArray(value, field, maximum = 250) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`${field} must be a string array`);
  }
  return [...value];
}

function parseDate(value, field) {
  const date = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be an ISO date`);
  }
  return date;
}

function validateEntry(entry) {
  if (
    entry?.action !== "insert" ||
    typeof entry.sourceShopDomain !== "string" ||
    !SHOP_DOMAIN.test(entry.sourceShopDomain)
  ) {
    throw new Error("Candidate contains an invalid Configuration entry");
  }
  const document = entry.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${entry.sourceShopDomain}: document is missing`);
  }
  const unsupported = Object.keys(document).filter(
    (field) => !DOCUMENT_FIELDS.has(field),
  );
  if (unsupported.length) {
    throw new Error(
      `${entry.sourceShopDomain}: unsupported fields: ${unsupported.join(", ")}`,
    );
  }
  if (!ObjectId.isValid(document.storeId)) {
    throw new Error(`${entry.sourceShopDomain}: invalid storeId`);
  }
  if (
    typeof document.alertsEmail !== "string" ||
    !EMAIL_ADDRESS.test(document.alertsEmail)
  ) {
    throw new Error(`${entry.sourceShopDomain}: invalid alertsEmail`);
  }
  if (
    typeof document.countryCode !== "string" ||
    !COUNTRY_CODE.test(document.countryCode)
  ) {
    throw new Error(`${entry.sourceShopDomain}: invalid countryCode`);
  }

  const colorOptions = stringArray(document.colorOptions, "colorOptions", 100);
  const sizeOptions = stringArray(document.sizeOptions, "sizeOptions", 100);
  if (
    !colorOptions.includes("Color") ||
    !colorOptions.includes("Colour") ||
    !sizeOptions.includes("Size")
  ) {
    throw new Error(
      `${entry.sourceShopDomain}: required Color, Colour, or Size option is missing`,
    );
  }
  if (
    document.colorOption !== null ||
    document.sizeOption !== null ||
    document.defaultGender !== null ||
    document.defaultAgeGroup !== null ||
    document.genderRules !== null ||
    document.ageRules !== null
  ) {
    throw new Error(`${entry.sourceShopDomain}: unsafe nullable defaults`);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof document[field] !== "boolean") {
      throw new Error(`${entry.sourceShopDomain}: ${field} must be boolean`);
    }
  }
  for (const field of VERSION_FIELDS) {
    if (!Number.isSafeInteger(document[field]) || document[field] !== 0) {
      throw new Error(`${entry.sourceShopDomain}: ${field} must be zero`);
    }
  }
  if (!REVISION.test(document.diagnosticsRevision)) {
    throw new Error(`${entry.sourceShopDomain}: invalid diagnosticsRevision`);
  }
  if (
    !["ALL_LOCATIONS", "SELECTED_LOCATIONS"].includes(
      document.inventorySourceMode,
    )
  ) {
    throw new Error(`${entry.sourceShopDomain}: invalid inventorySourceMode`);
  }
  if (!["DISABLED", "CART", "CHECKOUT"].includes(document.checkoutLinkMode)) {
    throw new Error(`${entry.sourceShopDomain}: invalid checkoutLinkMode`);
  }
  if (!Array.isArray(document.excludedCollections)) {
    throw new Error(`${entry.sourceShopDomain}: invalid excludedCollections`);
  }

  return {
    shopDomain: entry.sourceShopDomain,
    document: {
      ...document,
      storeId: new ObjectId(document.storeId),
      colorOptions,
      sizeOptions,
      excludedCollections: [...document.excludedCollections],
      excludedTitleTerms: stringArray(
        document.excludedTitleTerms,
        "excludedTitleTerms",
        100,
      ),
      selectedInventoryLocationIds: stringArray(
        document.selectedInventoryLocationIds,
        "selectedInventoryLocationIds",
      ),
      createdAt: parseDate(document.createdAt, "createdAt"),
      updatedAt: parseDate(document.updatedAt, "updatedAt"),
    },
  };
}

export function validateConfigurationCandidate(candidate) {
  if (
    candidate?.formatVersion !== 1 ||
    candidate?.candidateType !== "ConfigurationBulkInsert" ||
    candidate?.targetDatabase !== TARGET_DATABASE ||
    !Array.isArray(candidate.configurations) ||
    candidate.configurations.length === 0
  ) {
    throw new Error("Unsupported Configuration candidate");
  }
  if (
    candidate.policy?.updatesAllowed !== false ||
    candidate.policy?.deletesAllowed !== false
  ) {
    throw new Error("Candidate does not prohibit updates and deletes");
  }

  const entries = candidate.configurations.map(validateEntry);
  const domains = new Set();
  const storeIds = new Set();
  for (const entry of entries) {
    const storeId = entry.document.storeId.toHexString();
    if (domains.has(entry.shopDomain) || storeIds.has(storeId)) {
      throw new Error("Candidate contains duplicate stores");
    }
    domains.add(entry.shopDomain);
    storeIds.add(storeId);
  }
  return entries;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const candidate = JSON.parse(await readFile(resolve(options.file), "utf8"));
  const entries = validateConfigurationCandidate(candidate);
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

        const configurations = database.collection("Configuration");
        const collisions = await configurations
          .find(
            { storeId: { $in: storeIds } },
            { projection: { _id: 1 }, session },
          )
          .toArray();
        if (collisions.length) {
          throw new Error(
            "A candidate Store already has a Configuration; regenerate the candidate",
          );
        }

        const result = await configurations.insertMany(
          entries.map(({ document }) => document),
          { ordered: true, session },
        );
        inserted = result.insertedCount;
      });
    } finally {
      await session.endSession();
    }

    console.log(
      JSON.stringify(
        {
          candidateCount: entries.length,
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
    console.error(
      `[Approved Configuration migration] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
