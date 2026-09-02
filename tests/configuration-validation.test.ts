import assert from "node:assert/strict";
import test from "node:test";

import {
  availableOptionNames,
  configurationRequiresFeedRefresh,
  DEFAULT_COLOR_OPTIONS,
  DEFAULT_SIZE_OPTIONS,
  normalizeExcludedTitleTerms,
  normalizeOptionNames,
  normalizeProductTypes,
  resolveStoredOptionNames,
  validateConfigurationInput,
} from "../app/services/configuration-validation.ts";

test("title terms are trimmed and de-duplicated case-insensitively", () => {
  assert.deepEqual(
    normalizeExcludedTitleTerms([
      " Sample ",
      "sample",
      "Test   product",
      "",
      "Gift card",
    ]),
    ["Sample", "Test product", "Gift card"],
  );
});

test("product types are cleaned and de-duplicated case-insensitively", () => {
  assert.deepEqual(
    normalizeProductTypes([
      " Shoes ",
      "shoes",
      "Winter   Jackets",
      "",
      "T-Shirts",
      42,
    ]),
    ["Shoes", "Winter Jackets", "T-Shirts"],
  );
});

test("Color and Size mappings are empty until the merchant selects them", () => {
  assert.deepEqual([...DEFAULT_COLOR_OPTIONS], []);
  assert.deepEqual([...DEFAULT_SIZE_OPTIONS], []);
});

test("option names are normalized and de-duplicated case-insensitively", () => {
  assert.deepEqual(
    normalizeOptionNames([" Couleur ", "couleur", "Shoe   size", "", 42]),
    ["Couleur", "Shoe size"],
  );
});

test("Color and Size selectors hide names selected by the other attribute", () => {
  assert.deepEqual(
    availableOptionNames(
      ["Color", "Couleur", "Taille", "SIZE"],
      ["Color", "Couleur"],
      ["Size", "Taille"],
    ),
    ["Color", "Couleur"],
  );
  assert.deepEqual(
    availableOptionNames(
      ["Color", "Couleur", "Taille", "Size"],
      ["Taille", "Size"],
      ["colour", " COULEUR "],
    ),
    ["Color", "Taille", "Size"],
  );
});

test("legacy single options migrate without overriding initialized empty arrays", () => {
  assert.deepEqual(
    resolveStoredOptionNames([], " Couleur ", false, DEFAULT_COLOR_OPTIONS),
    ["Couleur"],
  );
  assert.deepEqual(
    resolveStoredOptionNames([], null, false, DEFAULT_COLOR_OPTIONS),
    [],
  );
  assert.deepEqual(
    resolveStoredOptionNames([], "Legacy", true, DEFAULT_COLOR_OPTIONS),
    [],
  );
});

test("configuration retains stable collection IDs and normalized store values", () => {
  const configuration = validateConfigurationInput({
    alertsEmail: " Alerts@Example.com ",
    countryCode: "lb",
    colorOptions: [" Colour ", "colour", "Taille"],
    sizeOptions: ["Shoe   size", "Taille"],
    excludedCollections: [
      {
        id: "gid://shopify/Collection/123",
        title: " Summer   Collection ",
      },
    ],
    excludedTitleTerms: [" Sample "],
    productTypes: [" Shoes ", "shoes", "Winter   Jackets"],
    showSalePriceInGoogleFeed: true,
    useProductImageAsMainImage: true,
    includeShippingWeightInGoogleFeed: true,
    excludeOutOfStockItems: true,
    ignoreShopifyInventoryInGoogleFeed: false,
    inventorySourceMode: "ALL_LOCATIONS",
    selectedInventoryLocationIds: [],
    disableUtmParameters: true,
    disablePrimaryCurrencyParameter: true,
    checkoutLinkMode: "CART",
  });

  assert.deepEqual(configuration, {
    alertsEmail: "alerts@example.com",
    countryCode: "LB",
    colorOptions: ["Colour", "Taille"],
    sizeOptions: ["Shoe size", "Taille"],
    excludedCollections: [
      {
        id: "gid://shopify/Collection/123",
        title: "Summer Collection",
      },
    ],
    excludedTitleTerms: ["Sample"],
    productTypes: ["Shoes", "Winter Jackets"],
    showSalePriceInGoogleFeed: true,
    useProductImageAsMainImage: true,
    includeShippingWeightInGoogleFeed: true,
    excludeOutOfStockItems: true,
    ignoreShopifyInventoryInGoogleFeed: false,
    inventorySourceMode: "ALL_LOCATIONS",
    selectedInventoryLocationIds: [],
    disableUtmParameters: true,
    disablePrimaryCurrencyParameter: true,
    checkoutLinkMode: "CART",
  });
});

test("product type configuration rejects empty, invalid, oversized, and excessive values", () => {
  const base = {
    alertsEmail: "alerts@example.com",
    countryCode: "US",
    colorOptions: ["Color"],
    excludedCollections: [],
    excludedTitleTerms: [],
    sizeOptions: ["Size"],
  };

  for (const productTypes of [
    "Shoes",
    ["   "],
    [42],
    ["x".repeat(256)],
    Array.from({ length: 101 }, (_, index) => `Type ${index}`),
  ]) {
    assert.throws(
      () => validateConfigurationInput({ ...base, productTypes }),
      /Correct the highlighted configuration fields/,
    );
  }

  assert.deepEqual(validateConfigurationInput(base).productTypes, []);
});

test("Product Type-only edits do not require an XML refresh", () => {
  const previous = validateConfigurationInput({
    alertsEmail: "alerts@example.com",
    countryCode: "US",
    colorOptions: ["Color"],
    excludedCollections: [],
    excludedTitleTerms: [],
    productTypes: ["Shoes"],
    sizeOptions: ["Size"],
  });

  assert.equal(
    configurationRequiresFeedRefresh(previous, {
      ...previous,
      productTypes: ["Shoes", "Accessories"],
    }),
    false,
  );
  assert.equal(
    configurationRequiresFeedRefresh(previous, {
      ...previous,
      countryCode: "LB",
    }),
    true,
  );
});

test("sale-price feed setting defaults false and validates Boolean values", () => {
  const base = {
    alertsEmail: "alerts@example.com",
    countryCode: "US",
    colorOptions: ["Color"],
    excludedCollections: [],
    excludedTitleTerms: [],
    sizeOptions: ["Size"],
  };

  assert.equal(
    validateConfigurationInput(base).showSalePriceInGoogleFeed,
    false,
  );
  assert.throws(
    () =>
      validateConfigurationInput({
        ...base,
        showSalePriceInGoogleFeed: "true",
      }),
    /Correct the highlighted configuration fields/,
  );
});

test("new Google feed settings default false and validate Boolean values", () => {
  const base = {
    alertsEmail: "alerts@example.com",
    countryCode: "US",
    colorOptions: ["Color"],
    excludedCollections: [],
    excludedTitleTerms: [],
    sizeOptions: ["Size"],
  };
  const defaults = validateConfigurationInput(base);

  assert.equal(defaults.useProductImageAsMainImage, false);
  assert.equal(defaults.includeShippingWeightInGoogleFeed, false);
  assert.equal(defaults.excludeOutOfStockItems, false);

  for (const field of [
    "useProductImageAsMainImage",
    "includeShippingWeightInGoogleFeed",
    "excludeOutOfStockItems",
  ] as const) {
    assert.throws(
      () =>
        validateConfigurationInput({
          ...base,
          [field]: "true",
        }),
      /Correct the highlighted configuration fields/,
    );
  }
});

test("inventory settings default safely and preserve stable Shopify location IDs", () => {
  const base = {
    alertsEmail: "alerts@example.com",
    countryCode: "US",
    colorOptions: ["Color"],
    excludedCollections: [],
    excludedTitleTerms: [],
    sizeOptions: ["Size"],
  };
  const defaults = validateConfigurationInput(base);

  assert.equal(defaults.ignoreShopifyInventoryInGoogleFeed, false);
  assert.equal(defaults.inventorySourceMode, "ALL_LOCATIONS");
  assert.deepEqual(defaults.selectedInventoryLocationIds, []);

  const selected = validateConfigurationInput({
    ...base,
    ignoreShopifyInventoryInGoogleFeed: true,
    inventorySourceMode: "SELECTED_LOCATIONS",
    selectedInventoryLocationIds: [
      "gid://shopify/Location/123",
      "gid://shopify/Location/456",
    ],
  });

  assert.equal(selected.ignoreShopifyInventoryInGoogleFeed, true);
  assert.equal(selected.inventorySourceMode, "SELECTED_LOCATIONS");
  assert.deepEqual(selected.selectedInventoryLocationIds, [
    "gid://shopify/Location/123",
    "gid://shopify/Location/456",
  ]);

  for (const invalid of [
    { inventorySourceMode: "SOMEWHERE" },
    { selectedInventoryLocationIds: ["gid://shopify/Product/123"] },
    {
      selectedInventoryLocationIds: [
        "gid://shopify/Location/123",
        "gid://shopify/Location/123",
      ],
    },
    { ignoreShopifyInventoryInGoogleFeed: "true" },
  ]) {
    assert.throws(
      () => validateConfigurationInput({ ...base, ...invalid }),
      /Correct the highlighted configuration fields/,
    );
  }
});

test("URL options default safely and validate every persisted setting", () => {
  const base = {
    alertsEmail: "alerts@example.com",
    countryCode: "US",
    colorOptions: ["Color"],
    excludedCollections: [],
    excludedTitleTerms: [],
    sizeOptions: ["Size"],
  };
  const defaults = validateConfigurationInput(base);

  assert.equal(defaults.disableUtmParameters, false);
  assert.equal(defaults.disablePrimaryCurrencyParameter, false);
  assert.equal(defaults.checkoutLinkMode, "DISABLED");
  assert.equal(
    validateConfigurationInput({
      ...base,
      checkoutLinkMode: "CHECKOUT",
      disablePrimaryCurrencyParameter: true,
      disableUtmParameters: true,
    }).checkoutLinkMode,
    "CHECKOUT",
  );
  assert.throws(
    () =>
      validateConfigurationInput({
        ...base,
        disableUtmParameters: "true",
      }),
    /Correct the highlighted configuration fields/,
  );
  assert.throws(
    () =>
      validateConfigurationInput({
        ...base,
        disablePrimaryCurrencyParameter: 1,
      }),
    /Correct the highlighted configuration fields/,
  );
  assert.throws(
    () =>
      validateConfigurationInput({
        ...base,
        checkoutLinkMode: "DIRECT",
      }),
    /Correct the highlighted configuration fields/,
  );
});
