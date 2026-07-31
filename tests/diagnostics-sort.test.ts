import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DIAGNOSTICS_SORT,
  diagnosticsSortValues,
  normalizeDiagnosticsSort,
} from "../app/services/diagnostics-sort.ts";

test("all supported Diagnostics sort values are preserved", () => {
  for (const sort of diagnosticsSortValues) {
    assert.equal(normalizeDiagnosticsSort(sort), sort);
  }
});

test("missing or unknown Diagnostics sorts use newest products first", () => {
  assert.equal(normalizeDiagnosticsSort(), DEFAULT_DIAGNOSTICS_SORT);
  assert.equal(normalizeDiagnosticsSort("vendor-asc"), DEFAULT_DIAGNOSTICS_SORT);
});
