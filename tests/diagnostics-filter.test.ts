import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnosticsFilterFields,
  normalizeDiagnosticsFilter,
  normalizeDiagnosticsFilterField,
} from "../app/services/diagnostics-filter.ts";

test("all supported Diagnostics filter fields are preserved", () => {
  for (const field of diagnosticsFilterFields) {
    assert.equal(normalizeDiagnosticsFilterField(field), field);
  }
});

test("invalid or incomplete Diagnostics filters are rejected", () => {
  assert.equal(normalizeDiagnosticsFilterField("vendor"), null);
  assert.equal(normalizeDiagnosticsFilter("gender", "  "), null);
  assert.equal(normalizeDiagnosticsFilter("vendor", "Adon"), null);
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
