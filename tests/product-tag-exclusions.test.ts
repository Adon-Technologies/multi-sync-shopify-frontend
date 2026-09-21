import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExcludedProductTags,
  createProductExclusionResolver,
} from "@multi-sync/catalog-rules";
import {
  validateConfigurationInput,
  configurationRequiresFeedRefresh,
} from "../app/services/configuration-validation.ts";
import { createDiagnosticsConfigurationRevision } from "../app/services/configuration-revision.server.ts";
import {
  countDiagnosticProducts,
  validateDiagnosticProduct,
  type RawDiagnosticProduct,
} from "../app/services/diagnostics-validation.ts";

const base = {
  alertsEmail: "owner@example.com",
  countryCode: "US",
  colorOptions: [],
  sizeOptions: [],
};

test("tag configuration trims and deduplicates while preserving display text", () => {
  assert.deepEqual(
    normalizeExcludedProductTags([
      " Clearance ",
      "clearance",
      "google-exclude",
      "",
      9,
    ]),
    ["Clearance", "google-exclude"],
  );
  const saved = validateConfigurationInput({
    ...base,
    excludedProductTags: [" Clearance ", "CLEARANCE", "google-exclude"],
  });
  assert.deepEqual(saved.excludedProductTags, ["Clearance", "google-exclude"]);
  assert.deepEqual(
    validateConfigurationInput(JSON.parse(JSON.stringify(saved)))
      .excludedProductTags,
    saved.excludedProductTags,
  );
  assert.deepEqual(validateConfigurationInput(base).excludedProductTags, []);
  assert.deepEqual(
    validateConfigurationInput({ ...base, excludedProductTags: [] })
      .excludedProductTags,
    [],
  );
  for (const invalid of [
    null,
    "Sale",
    [""],
    [42],
    ["x".repeat(256)],
    Array(101).fill("Sale"),
  ]) {
    assert.throws(() =>
      validateConfigurationInput({ ...base, excludedProductTags: invalid }),
    );
  }
});

test("tag changes invalidate feeds and Diagnostics snapshots; order and case do not change revision", () => {
  const initial = validateConfigurationInput(base);
  const changed = validateConfigurationInput({
    ...base,
    excludedProductTags: ["Sale", "Clearance"],
  });
  assert.equal(configurationRequiresFeedRefresh(initial, changed), true);
  assert.notEqual(
    createDiagnosticsConfigurationRevision(initial),
    createDiagnosticsConfigurationRevision(changed),
  );
  assert.equal(
    createDiagnosticsConfigurationRevision(changed),
    createDiagnosticsConfigurationRevision({
      excludedProductTags: [" clearance ", "SALE", "sale"],
    }),
  );
  assert.equal(
    createDiagnosticsConfigurationRevision(initial),
    createDiagnosticsConfigurationRevision({ excludedProductTags: [] }),
  );
});

test("whole tags match with OR semantics and existing collection/title exclusions still work", () => {
  const resolve = createProductExclusionResolver({
    excludedProductTags: ["Sale", "Clearance", "google-exclude"],
    excludedTitleTerms: ["sample"],
    excludedCollections: [
      { id: "gid://shopify/Collection/1", title: "Hidden" },
    ],
  });
  assert.deepEqual(
    resolve({ title: "Shoes", tags: ["Wholesale", "Summer"] }),
    [],
  );
  for (const tags of [
    ["Clearance"],
    ["summer", " SALE "],
    ["google-exclude"],
    ["Sale", "Clearance"],
  ]) {
    assert.ok(resolve({ title: "Shoes", tags }).length > 0);
  }
  assert.match(resolve({ title: "Sample shoes" })[0]!.message, /title term/);
  assert.match(
    resolve({
      title: "Shoes",
      collectionIds: ["gid://shopify/Collection/1"],
    })[0]!.message,
    /Excluded collection/,
  );
  assert.equal(
    createProductExclusionResolver({
      excludedProductTags: [],
      excludedCollections: [],
      excludedTitleTerms: [],
    })({ title: "Shoes", tags: ["Sale"] }).length,
    0,
  );
});

test("Diagnostics uses its existing Excluded status, reason and counts", () => {
  const product: RawDiagnosticProduct = {
    id: "1",
    title: "Shoes",
    tags: ["Clearance"],
    createdAt: "2026-09-18",
    categoryName: null,
    description: "Shoes",
    price: "10",
    productType: "Shoes",
    imageUrl: null,
    imageAlt: null,
    options: [],
    metafields: [],
  };
  const rules = {
    excludedCollections: [],
    excludedTitleTerms: [],
    excludedProductTags: ["clearance"],
  };
  const excluded = validateDiagnosticProduct(product, rules);
  assert.equal(excluded.status, "error");
  assert.deepEqual(excluded.warnings, [
    { code: "excluded-tag-1", message: "Excluded by tag: Clearance" },
  ]);
  const included = validateDiagnosticProduct(
    { ...product, id: "2", tags: ["Summer"] },
    rules,
  );
  assert.notEqual(included.status, "error");
  assert.equal(countDiagnosticProducts([excluded, included]).excluded, 1);
});
