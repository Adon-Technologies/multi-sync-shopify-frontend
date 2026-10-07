import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductExclusions } from "@multi-sync/catalog-rules";
import { configurationRequiresFeedRefresh, ConfigurationValidationError, validateConfigurationInput } from "../app/services/configuration-validation.ts";
import { createDiagnosticsConfigurationRevision } from "../app/services/configuration-revision.server.ts";

const id = (n: number) => `gid://shopify/Collection/${n}`;
const base = { alertsEmail: "owner@example.com", countryCode: "US", colorOptions: [], sizeOptions: [], excludedCollections: [], excludedTitleTerms: [] };

test("legacy Configuration defaults to All products and retains current exclusion behavior", () => {
  const legacy = validateConfigurationInput(base);
  assert.equal(legacy.productSubmissionMode, "ALL_PRODUCTS");
  assert.deepEqual(legacy.includedCollectionIds, []);
  assert.deepEqual(resolveProductExclusions({ title: "Shoes" }, legacy), []);
  assert.deepEqual(resolveProductExclusions({ title: "Shoes" }, { ...legacy, productSubmissionMode: "ALL_PRODUCTS", includedCollectionIds: [id(1)] }), []);
});

test("selected collection mode requires valid non-excluded IDs", () => {
  for (const includedCollectionIds of [[], ["invalid"], [id(1), id(1)], null]) {
    assert.throws(() => validateConfigurationInput({ ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds }), ConfigurationValidationError);
  }
  assert.throws(() => validateConfigurationInput({ ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)], excludedCollections: [{ id: id(1), title: "Hidden" }] }), /Correct the highlighted/);
});

test("OR membership is ID based; renames do not change inclusion or Diagnostics revisions", () => {
  const rules = validateConfigurationInput({ ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1), id(2)] });
  for (const collectionIds of [[id(1)], [id(2)], [id(1), id(2)]]) {
    assert.deepEqual(resolveProductExclusions({ title: "Renamed product", collectionIds }, rules), []);
  }
  assert.equal(resolveProductExclusions({ title: "Shoes", collectionIds: [] }, rules)[0]?.message, "Not in selected collections");
  assert.equal(createDiagnosticsConfigurationRevision(rules), createDiagnosticsConfigurationRevision({ ...rules, includedCollectionIds: [id(2), id(1)] }));
  assert.equal(createDiagnosticsConfigurationRevision(base), createDiagnosticsConfigurationRevision({ ...base, productSubmissionMode: "ALL_PRODUCTS", includedCollectionIds: [] }));
});

test("inclusion never bypasses title, tag or collection exclusions", () => {
  const rules = validateConfigurationInput({ ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)], excludedTitleTerms: ["Sample"], excludedProductTags: ["Hidden"], excludedCollections: [{ id: id(9), title: "Excluded" }] });
  for (const product of [
    { title: "Sample shoes", collectionIds: [id(1)] },
    { title: "Shoes", tags: ["hidden"], collectionIds: [id(1)] },
    { title: "Shoes", collectionIds: [id(1), id(9)] },
  ]) assert.equal(resolveProductExclusions(product, rules).length, 1);
});

test("switching mode or collection IDs requires refresh and invalidates Diagnostics; switching back restores defaults", () => {
  const all = validateConfigurationInput(base);
  const selected = validateConfigurationInput({ ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] });
  const changed = { ...selected, includedCollectionIds: [id(2)] };
  assert.ok(configurationRequiresFeedRefresh(all, selected));
  assert.ok(configurationRequiresFeedRefresh(selected, changed));
  assert.ok(configurationRequiresFeedRefresh(selected, all));
  assert.notEqual(createDiagnosticsConfigurationRevision(all), createDiagnosticsConfigurationRevision(selected));
  assert.notEqual(createDiagnosticsConfigurationRevision(selected), createDiagnosticsConfigurationRevision(changed));
});
