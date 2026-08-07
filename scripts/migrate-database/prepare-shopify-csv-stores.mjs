import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MongoClient } from "mongodb";

import {
  buildCsvReconciliationEntry,
  readShopifyMerchantRows,
} from "./shopify-csv-store-transform.mjs";

const TARGET_DATABASE = "Multi-sync";
const DEFAULT_OUTPUT =
  "scripts/migrate-database/shopify-csv-store-reconciliation.candidate.json";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseArguments(arguments_) {
  const options = {
    file: null,
    output: DEFAULT_OUTPUT,
  };

  for (const argument of arguments_) {
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: npm run migrate:stores:shopify-csv -- --file=PATH [--output=PATH]",
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

function indexByDomain(documents) {
  return new Map(
    documents.map((document) => [
      String(document.shopDomain).trim().toLowerCase(),
      document,
    ]),
  );
}

function countActions(stores, action) {
  return stores.filter((store) => store.action === action).length;
}

export async function prepareShopifyCsvStores({
  csvPath,
  mongoUri = requiredEnvironment("DATABASE_URL"),
  outputPath,
}) {
  const generatedAt = new Date();
  const csvText = await readFile(csvPath, "utf8");
  const merchants = readShopifyMerchantRows(csvText, csvPath);
  const domains = merchants.map((merchant) => merchant.shopDomain);
  const targetClient = new MongoClient(mongoUri);

  try {
    await targetClient.connect();
    const targetDb = targetClient.db(TARGET_DATABASE);
    const targetStores = await targetDb
      .collection("Store")
      .find(
        { shopDomain: { $in: domains } },
        {
          projection: {
            shopDomain: 1,
            shopPlan: 1,
            accessToken: 1,
            status: 1,
            uninstalledAt: 1,
            updatedAt: 1,
          },
        },
      )
      .toArray();
    const targetStoresByShop = indexByDomain(targetStores);
    const stores = merchants.map((merchant) =>
      buildCsvReconciliationEntry({
        existingStore: targetStoresByShop.get(merchant.shopDomain),
        generatedAt,
        merchant,
      }),
    );
    const planCounts = Object.fromEntries(
      [...new Set(stores.map((store) => store.shopifyPlan))]
        .sort()
        .map((plan) => [
          plan,
          stores.filter((store) => store.shopifyPlan === plan).length,
        ]),
    );

    const candidate = {
      formatVersion: 1,
      candidateType: "StoreCsvReconciliation",
      generatedAt,
      sourceFile: basename(csvPath),
      sourceCsvSha256: createHash("sha256").update(csvText).digest("hex"),
      targetDatabase: TARGET_DATABASE,
      policy: {
        csvIsAuthoritativeForAppInstallation: true,
        csvShopsBecomeInstalled: true,
        storesOutsideCsvAreUnchanged: true,
        existingAccessTokensArePreserved: true,
        missingAccessTokensRemainNull: true,
        deletesAllowed: false,
      },
      summary: {
        csvShops: stores.length,
        updates: countActions(stores, "update"),
        reactivations: countActions(stores, "reactivate"),
        inserts: countActions(stores, "insert"),
        finalInstalled: stores.length,
        finalUninstalled: 0,
        missingAccessTokens: stores.filter(
          (store) => !store.accessTokenAvailable,
        ).length,
        inactiveShopPlans: stores.filter(
          (store) => store.shopifyPlan.toLowerCase() === "inactive",
        ).length,
        warnings: stores.reduce(
          (total, store) => total + store.warnings.length,
          0,
        ),
        planCounts,
        targetWrites: 0,
        deletes: 0,
      },
      stores,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8",
    );
    return candidate;
  } finally {
    await targetClient.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const candidate = await prepareShopifyCsvStores({
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
      `[Shopify CSV Store preview] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
