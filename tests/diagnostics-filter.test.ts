import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnosticsFilterFields,
  diagnosticsStaticFilterOptions,
  normalizeDiagnosticsFilter,
  normalizeDiagnosticsFilterField,
  normalizeDiagnosticsFilters,
  parseDiagnosticsFilters,
} from "../app/services/diagnostics-filter.ts";

test("all supported Diagnostics filter fields are preserved", () => {
  for (const field of diagnosticsFilterFields) {
    assert.equal(normalizeDiagnosticsFilterField(field), field);
  }
});

test("invalid or incomplete Diagnostics filters are rejected", () => {
  assert.equal(normalizeDiagnosticsFilterField("manufacturer"), null);
  assert.equal(normalizeDiagnosticsFilter("gender", "  "), null);
  assert.deepEqual(normalizeDiagnosticsFilter("vendor", "Adon"), {
    field: "vendor",
    value: "Adon",
  });
});

test("all requested product and variant filter fields are supported", () => {
  assert.deepEqual(
    [
      "gender",
      "age",
      "color",
      "size",
      "vendor",
      "custom-label-0",
      "custom-label-1",
      "custom-label-2",
      "custom-label-3",
      "custom-label-4",
    ].filter((field) => !diagnosticsFilterFields.includes(field as never)),
    [],
  );
  assert.deepEqual(
    diagnosticsStaticFilterOptions.gender?.map(({ label }) => label),
    ["Men", "Women", "Unisex"],
  );
  assert.deepEqual(
    diagnosticsStaticFilterOptions.age?.map(({ label }) => label),
    ["Newborn", "Infant", "Toddler", "Kids", "Adult"],
  );
});

test("multiple filters have stable ordering and one row per type", () => {
  assert.deepEqual(
    normalizeDiagnosticsFilters([
      { field: "vendor", value: " Nike " },
      { field: "color", value: "Black" },
      { field: "vendor", value: "Adidas" },
      { field: "custom-label-0", value: "Best Selling" },
    ]),
    [
      { field: "color", value: "Black" },
      { field: "vendor", value: "Adidas" },
      { field: "custom-label-0", value: "Best Selling" },
    ],
  );
});

test("serialized filters parse safely and legacy single filters remain supported", () => {
  assert.deepEqual(
    parseDiagnosticsFilters(
      JSON.stringify([
        { field: "size", value: "XL" },
        { field: "vendor", value: "Nike" },
      ]),
    ),
    [
      { field: "size", value: "XL" },
      { field: "vendor", value: "Nike" },
    ],
  );
  assert.deepEqual(parseDiagnosticsFilters(null, "tag", "Sale"), [
    { field: "tag", value: "Sale" },
  ]);
});

test("Diagnostics filter values are trimmed without changing their casing", () => {
  assert.deepEqual(normalizeDiagnosticsFilter("tag", "  Summer Sale  "), {
    field: "tag",
    value: "Summer Sale",
  });
});

test("Shopify collection IDs are accepted as Diagnostics filter values", () => {
  assert.deepEqual(
    normalizeDiagnosticsFilter(
      "collection",
      "  gid://shopify/Collection/123  ",
    ),
    {
      field: "collection",
      value: "gid://shopify/Collection/123",
    },
  );
});
