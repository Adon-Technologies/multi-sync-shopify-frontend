import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConfigurationEntry,
  parseConfigurationCsv,
} from "./prepare-configurations.mjs";

test("Configuration candidate uses Shopify CSV identity and app defaults", () => {
  const shops = parseConfigurationCsv(
    [
      "Shop domain,Shop email,Shop country",
      "example.myshopify.com,Owner@Example.com,nl",
    ].join("\n"),
  );
  const generatedAt = new Date("2026-08-07T12:00:00.000Z");
  const shop = shops.get("example.myshopify.com");
  shop.shopDomain = "example.myshopify.com";
  const result = buildConfigurationEntry({
    generatedAt,
    legacyStore: {
      colorOptionName: [" Colour ", "Color", "color"],
      excludedCollectionTitles: [],
      sizeOptionName: ["Size", " SIZE "],
    },
    shop,
    storeId: "6a758b00694d376a5b3ddcaf",
  });

  assert.equal(result.document.alertsEmail, "owner@example.com");
  assert.equal(result.document.countryCode, "NL");
  assert.deepEqual(result.document.colorOptions, ["Colour", "Color"]);
  assert.deepEqual(result.document.sizeOptions, ["Size"]);
  assert.equal(result.document.inventorySourceMode, "ALL_LOCATIONS");
  assert.equal(result.document.checkoutLinkMode, "DISABLED");
  assert.equal(result.document.optionMappingsInitialized, true);
  assert.equal(result.warnings.length, 0);
  assert.match(result.document.diagnosticsRevision, /^[a-f0-9]{64}$/);
});

test("Configuration candidate records empty fallbacks as warnings", () => {
  const result = buildConfigurationEntry({
    generatedAt: new Date("2026-08-07T12:00:00.000Z"),
    legacyStore: undefined,
    shop: {
      alertsEmail: null,
      countryCode: null,
      shopDomain: "example.myshopify.com",
    },
    storeId: "6a758b00694d376a5b3ddcaf",
  });

  assert.equal(result.document.alertsEmail, "");
  assert.equal(result.document.countryCode, "");
  assert.deepEqual(result.document.colorOptions, ["Color", "Colour"]);
  assert.deepEqual(result.document.sizeOptions, ["Size"]);
  assert.equal(result.warnings.length, 2);
});

test("Legacy excluded collection titles are not converted into fake IDs", () => {
  const result = buildConfigurationEntry({
    generatedAt: new Date("2026-08-07T12:00:00.000Z"),
    legacyStore: {
      colorOptionName: [],
      excludedCollectionTitles: ["Testing Collection"],
      sizeOptionName: [],
    },
    shop: {
      alertsEmail: "owner@example.com",
      countryCode: "US",
      shopDomain: "example.myshopify.com",
    },
    storeId: "6a758b00694d376a5b3ddcaf",
  });

  assert.deepEqual(result.document.excludedCollections, []);
  assert.equal(result.warnings.length, 1);
});

test("Required Color, Colour, and Size names are added to legacy arrays", () => {
  const result = buildConfigurationEntry({
    generatedAt: new Date("2026-08-07T12:00:00.000Z"),
    legacyStore: {
      colorOptionName: ["Färg"],
      excludedCollectionTitles: [],
      sizeOptionName: ["Storlek"],
    },
    shop: {
      alertsEmail: "owner@example.com",
      countryCode: "SE",
      shopDomain: "example.myshopify.com",
    },
    storeId: "6a758b00694d376a5b3ddcaf",
  });

  assert.deepEqual(result.document.colorOptions, ["Färg", "Color", "Colour"]);
  assert.deepEqual(result.document.sizeOptions, ["Storlek", "Size"]);
});
