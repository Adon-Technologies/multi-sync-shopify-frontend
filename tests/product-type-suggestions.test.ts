import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  filterProductTypeSuggestions,
  mergeProductTypeSuggestions,
} from "../app/services/product-type-suggestions.ts";

const diagnosticsSource = readFileSync(
  new URL("../app/components/DiagnosticsPanel.tsx", import.meta.url),
  "utf8",
);
const configurationRouteSource = readFileSync(
  new URL("../app/routes/app.configuration-data.tsx", import.meta.url),
  "utf8",
);
const configurationQuerySource = readFileSync(
  new URL("../app/services/configuration-query.ts", import.meta.url),
  "utf8",
);
const configurationServerSource = readFileSync(
  new URL("../app/services/configuration.server.ts", import.meta.url),
  "utf8",
);
const configurationSchemaSource = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const diagnosticsStyles = readFileSync(
  new URL("../app/styles/diagnostics.module.css", import.meta.url),
  "utf8",
);

test("configured and Shopify Product Types merge into one sorted list", () => {
  assert.deepEqual(
    mergeProductTypeSuggestions(
      [" Shoes ", "Accessories", "Winter Jackets"],
      ["T-Shirts", "Boots", "Electronics"],
    ),
    [
      "Accessories",
      "Boots",
      "Electronics",
      "Shoes",
      "T-Shirts",
      "Winter Jackets",
    ],
  );
});

test("Product Type suggestions remove case-insensitive duplicates", () => {
  assert.deepEqual(
    mergeProductTypeSuggestions(
      ["Shoes", "SHOES", " Winter   Jackets "],
      ["shoes", "winter jackets", "Boots"],
    ),
    ["Boots", "Shoes", "Winter Jackets"],
  );
});

test("Product Type suggestions filter case-insensitively", () => {
  const values = ["Accessories", "Luxury Footwear", "Shoes", "T-Shirts"];

  assert.deepEqual(filterProductTypeSuggestions(values, " shoe "), ["Shoes"]);
  assert.deepEqual(filterProductTypeSuggestions(values, "FOOT"), [
    "Luxury Footwear",
  ]);
  assert.deepEqual(filterProductTypeSuggestions(values, ""), values);
  assert.deepEqual(filterProductTypeSuggestions(values, "missing"), []);
});

test("Product Type query keys isolate stores and sessions", () => {
  assert.match(
    configurationQuerySource,
    /productTypes:[\s\S]*\{ shop, sessionId \}[\s\S]*\["configuration-product-types", shop, sessionId, endpoint\]/,
  );
});

test("Product Type suggestions load both store-scoped sources", () => {
  assert.match(
    configurationRouteSource,
    /Promise\.all\(\[[\s\S]*getConfiguredProductTypes\(session\.shop\)[\s\S]*getShopProductTypes\(admin, session\.shop\)/,
  );
  assert.match(
    configurationRouteSource,
    /mergeProductTypeSuggestions\([\s\S]*configuredProductTypes,[\s\S]*shopifyProductTypes/,
  );
  assert.match(
    configurationServerSource,
    /where: \{ shopDomain: normalizeShopDomain\(shop\) \}/,
  );
});

test("configured Product Types persist as an array and reload with Configuration", () => {
  assert.match(
    configurationSchemaSource,
    /productTypes\s+String\[\]\s+@default\(\[\]\)/,
  );
  assert.match(
    configurationServerSource,
    /productTypes: normalizeProductTypes\(configuration\.productTypes\)/,
  );
  assert.match(configurationServerSource, /productTypes: \[\]/);
  assert.match(
    configurationServerSource,
    /const verifiedInput = \{[\s\S]*\.\.\.input,[\s\S]*selectedInventoryLocationIds/,
  );
});

test("Diagnostics selector supports loading, empty, failure, selection, and custom text", () => {
  assert.match(diagnosticsSource, /function ProductTypeSelector/);
  assert.match(diagnosticsSource, /aria-label="Available product types"/);
  assert.match(diagnosticsSource, /placeholder="Search product types"/);
  assert.match(diagnosticsSource, /Loading product type suggestions/);
  assert.match(diagnosticsSource, /No product type suggestions found/);
  assert.match(diagnosticsSource, /Product type suggestions are unavailable/);
  assert.match(
    diagnosticsSource,
    /You can still type and apply a new product type\./,
  );
  assert.match(
    diagnosticsSource,
    /onClick=\{\(\) => onChange\(productType\)\}/,
  );
  assert.match(
    diagnosticsSource,
    /onClick=\{\(\) => onChange\(normalizedSearch\)\}/,
  );
});

test("the Product Type trigger renders inside the Assign dialog", () => {
  const modalStart = diagnosticsSource.indexOf("id={BULK_EDIT_MODAL_ID}");
  const selector = diagnosticsSource.indexOf(
    "<ProductTypeSelector",
    modalStart,
  );
  const modalEnd = diagnosticsSource.indexOf("</s-modal>", modalStart);

  assert.ok(modalStart >= 0);
  assert.ok(selector > modalStart && selector < modalEnd);
  assert.doesNotMatch(diagnosticsSource, /<Autocomplete/);
});

test("Product Type suggestions use the modal-safe anchored popover", () => {
  assert.match(
    diagnosticsSource,
    /command="--show"[\s\S]*commandFor=\{PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID\}/,
  );
  assert.match(
    diagnosticsSource,
    /<s-popover[\s\S]*id=\{PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID\}/,
  );
  assert.match(
    diagnosticsSource,
    /command="--hide"[\s\S]*commandFor=\{PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID\}/,
  );
  assert.doesNotMatch(
    diagnosticsSource,
    /createPortal|showPopover|pointerdown/,
  );
  assert.match(diagnosticsSource, /event\.stopPropagation\(\)/);
  assert.match(
    diagnosticsSource,
    /event\.target === event\.currentTarget[\s\S]*setBulkEditModalOpen\(false\)/,
  );
});

test("Product Type suggestions scroll without expanding the Assign dialog", () => {
  assert.match(
    diagnosticsStyles,
    /\.productTypeSuggestionOptions\s*\{[\s\S]*max-height:\s*260px;[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain/,
  );
  assert.doesNotMatch(
    diagnosticsStyles,
    /\.productTypeSuggestionDialog\s*\{[\s\S]*position:\s*fixed/,
  );
  assert.match(
    diagnosticsSource,
    /getBoundingClientRect\(\)\.width[\s\S]*inlineSize=\{popoverInlineSize\}/,
  );
});

test("the Product Type popover has its own focused search field", () => {
  assert.match(
    diagnosticsSource,
    /<s-popover[\s\S]*<s-search-field[\s\S]*label="Search product types"/,
  );
  assert.match(
    diagnosticsSource,
    /filterProductTypeSuggestions\([\s\S]*productTypes,[\s\S]*normalizedSearch/,
  );
  assert.match(diagnosticsSource, /searchRef\.current\?\.focus\(\)/);
});

test("typed Product Types can be applied without selecting a suggestion", () => {
  assert.match(
    diagnosticsSource,
    /onInput=\{\(event\) => \{[\s\S]*const nextValue = event\.currentTarget\.value;[\s\S]*setSuggestionSearch\(nextValue\);[\s\S]*onChange\([\s\S]*normalizeConfigurationText\(nextValue\)/,
  );
  assert.match(diagnosticsSource, /setSuggestionSearch\(value\)/);
});

test("Product Type suggestions refresh after a completed bulk update", () => {
  assert.match(
    diagnosticsSource,
    /job\.edit\.kind === "productType"[\s\S]*configurationKeys\.productTypes\(scope\)[\s\S]*refetchType: "none"[\s\S]*productTypeSuggestionsQueryOptions\(scope, \{ force: true \}\)/,
  );
});
