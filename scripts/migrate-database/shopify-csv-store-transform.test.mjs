import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCsvReconciliationEntry,
  parseCsv,
  readShopifyMerchantRows,
} from "./shopify-csv-store-transform.mjs";

test("parses quoted Shopify CSV fields safely", () => {
  assert.deepEqual(
    parseCsv(
      'Shop name,Shop domain,Shop plan,Install date\n"Store, One",example.myshopify.com,Basic,2026-01-01 10:20:30 UTC\n',
    ),
    [
      {
        "Shop name": "Store, One",
        "Shop domain": "example.myshopify.com",
        "Shop plan": "Basic",
        "Install date": "2026-01-01 10:20:30 UTC",
      },
    ],
  );
});

test("normalizes Shopify merchant rows and rejects duplicates", () => {
  const header = "Shop domain,Shop plan,Install date\n";
  const row = " Example.myshopify.com ,Basic,2026-01-01 10:20:30 UTC\n";
  const merchants = readShopifyMerchantRows(
    header + row,
    "current-merchants.csv",
  );

  assert.equal(merchants[0].shopDomain, "example.myshopify.com");
  assert.equal(
    merchants[0].installDate.toISOString(),
    "2026-01-01T10:20:30.000Z",
  );
  assert.throws(
    () => readShopifyMerchantRows(header + row + row, "current-merchants.csv"),
    /duplicate shop/,
  );
});

test("proposes a missing CSV shop as INSTALLED even without a token", () => {
  const generatedAt = new Date("2026-08-07T08:00:00.000Z");
  const result = buildCsvReconciliationEntry({
    generatedAt,
    merchant: {
      installDate: new Date("2026-01-01T10:20:30.000Z"),
      shopDomain: "example.myshopify.com",
      shopPlan: "Basic",
      sourceCollection: "current-merchants.csv",
    },
  });

  assert.equal(result.accessTokenAvailable, false);
  assert.equal(result.action, "insert");
  assert.equal(result.document.status, "INSTALLED");
  assert.equal(result.document.shopPlan, "Basic");
  assert.equal(result.document.accessToken, null);
  assert.equal(result.document.uninstalledAt, null);
  assert.deepEqual(Object.keys(result.document).slice(0, 5), [
    "shopDomain",
    "shopPlan",
    "accessStatus",
    "accessToken",
    "status",
  ]);
});

test("proposes an existing uninstalled shop for reactivation and preserves its token", () => {
  const result = buildCsvReconciliationEntry({
    existingStore: {
      _id: "66aa11111111111111111111",
      accessToken: "secret",
      shopPlan: null,
      status: "UNINSTALLED",
      uninstalledAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
    generatedAt: new Date("2026-08-07T08:00:00.000Z"),
    merchant: {
      installDate: new Date("2026-01-01T10:20:30.000Z"),
      shopDomain: "example.myshopify.com",
      shopPlan: "Basic",
      sourceCollection: "current-merchants.csv",
    },
  });

  assert.equal(result.accessTokenAvailable, true);
  assert.equal(result.action, "reactivate");
  assert.equal(result.document, null);
  assert.deepEqual(result.changes, {
    shopPlan: "Basic",
    status: "INSTALLED",
    uninstalledAt: null,
    updatedAt: new Date("2026-08-07T08:00:00.000Z"),
  });
});
