import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createDiagnosticsBulkSelectionScope,
  diagnosticsBulkSelectionCount,
  diagnosticsPageSelectionState,
  emptyDiagnosticsBulkSelection,
  isDiagnosticsProductSelected,
  selectAllMatchingDiagnosticsProducts,
  serializeDiagnosticsBulkSelection,
  toggleDiagnosticsPage,
  toggleDiagnosticsProduct,
  undoAllMatchingDiagnosticsProducts,
} from "../app/services/diagnostics-bulk-edit.ts";
import {
  DIAGNOSTICS_PAGE_SIZES,
  normalizeDiagnosticsPageSize,
} from "../app/services/diagnostics-pagination.ts";

const product = (id: number) => `gid://shopify/Product/${id}`;
const scope = createDiagnosticsBulkSelectionScope({
  diagnosticsTab: "warnings",
  filters: [
    { field: "product-type", value: " Shoes " },
    { field: "vendor", value: " Nike " },
  ],
  search: "  Summer   Dress ",
  snapshotVersion: "diagnostics-v13:scan-test",
});

test("individual and multiple explicit products can be selected", () => {
  let selection = emptyDiagnosticsBulkSelection();
  selection = toggleDiagnosticsProduct(selection, product(1), true);
  assert.equal(diagnosticsBulkSelectionCount(selection), 1);
  assert.equal(isDiagnosticsProductSelected(selection, product(1)), true);
  selection = toggleDiagnosticsProduct(selection, product(2), true);
  assert.equal(diagnosticsBulkSelectionCount(selection), 2);
  selection = toggleDiagnosticsProduct(selection, product(1), false);
  assert.equal(selection.mode, "explicit");
  if (selection.mode !== "explicit") return;
  assert.deepEqual([...selection.productIds], [product(2)]);
});

test("header selection selects and deselects only the displayed page", () => {
  const pageOne = [product(1), product(2), product(3)];
  let selection = toggleDiagnosticsPage(
    emptyDiagnosticsBulkSelection(),
    pageOne,
    true,
  );
  assert.deepEqual(diagnosticsPageSelectionState(selection, pageOne), {
    checked: true,
    indeterminate: false,
    selectedCount: 3,
  });
  selection = toggleDiagnosticsPage(selection, pageOne, false);
  assert.equal(diagnosticsBulkSelectionCount(selection), 0);
});

test("header selection becomes indeterminate for a partial page", () => {
  const pageOne = [product(1), product(2), product(3)];
  const selection = toggleDiagnosticsProduct(
    emptyDiagnosticsBulkSelection(),
    product(2),
    true,
  );
  assert.deepEqual(diagnosticsPageSelectionState(selection, pageOne), {
    checked: false,
    indeterminate: true,
    selectedCount: 1,
  });
});

test("explicit selection persists while products from later pages are added", () => {
  let selection = toggleDiagnosticsPage(
    emptyDiagnosticsBulkSelection(),
    [product(1), product(2)],
    true,
  );
  selection = toggleDiagnosticsProduct(selection, product(26), true);
  assert.equal(selection.mode, "explicit");
  if (selection.mode !== "explicit") return;
  assert.deepEqual(
    [...selection.productIds],
    [product(1), product(2), product(26)],
  );
});

test("all-matching mode stores scope and only deselected exclusions", () => {
  let selection = selectAllMatchingDiagnosticsProducts(scope, 5_000);
  assert.equal(diagnosticsBulkSelectionCount(selection), 5_000);
  selection = toggleDiagnosticsProduct(selection, product(9), false);
  assert.equal(diagnosticsBulkSelectionCount(selection), 4_999);
  assert.equal(isDiagnosticsProductSelected(selection, product(9)), false);

  const request = serializeDiagnosticsBulkSelection(
    selection,
    scope,
    { kind: "productType", value: " Shoes " },
    "request_12345678",
  );
  assert.deepEqual(request.selection, {
    excludedProductIds: [product(9)],
    mode: "allMatching",
  });
  assert.equal("productIds" in request.selection, false);
  assert.equal(request.scope.diagnosticsTab, "warnings");
  assert.equal(request.scope.search, "summer   dress");
  assert.deepEqual(request.scope.filters, [
    { field: "vendor", value: "Nike" },
    { field: "product-type", value: "Shoes" },
  ]);
});

test("undo all matching returns to current-page explicit selection", () => {
  let selection = selectAllMatchingDiagnosticsProducts(scope, 5_000);
  selection = toggleDiagnosticsProduct(selection, product(2), false);
  const explicit = undoAllMatchingDiagnosticsProducts(selection, [
    product(1),
    product(2),
    product(3),
  ]);
  assert.equal(explicit.mode, "explicit");
  assert.deepEqual([...explicit.productIds], [product(1), product(3)]);
});

test("blank and whitespace-only custom labels serialize as clearing", () => {
  const selection = toggleDiagnosticsProduct(
    emptyDiagnosticsBulkSelection(),
    product(1),
    true,
  );
  const request = serializeDiagnosticsBulkSelection(
    selection,
    scope,
    { index: 3, kind: "customLabel", value: "   " },
    "request_12345678",
  );
  assert.deepEqual(request.edit, {
    index: 3,
    kind: "customLabel",
    value: "",
  });
});

test("blank and whitespace-only Product Types serialize as clearing", () => {
  const selection = toggleDiagnosticsProduct(
    emptyDiagnosticsBulkSelection(),
    product(1),
    true,
  );
  const request = serializeDiagnosticsBulkSelection(
    selection,
    scope,
    { kind: "productType", value: "   " },
    "request_12345678",
  );

  assert.deepEqual(request.edit, {
    kind: "productType",
    value: "",
  });
});

test("Diagnostics page size accepts only 10, 25, or 50 products", () => {
  assert.deepEqual(DIAGNOSTICS_PAGE_SIZES, [10, 25, 50]);
  assert.equal(normalizeDiagnosticsPageSize("10"), 10);
  assert.equal(normalizeDiagnosticsPageSize("50"), 50);
  assert.equal(normalizeDiagnosticsPageSize("5000"), 25);
});

test("Diagnostics UI keeps normal headers and provides the Polaris bulk workflow", () => {
  const source = readFileSync(
    new URL("../app/components/DiagnosticsPanel.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/styles/diagnostics.module.css", import.meta.url),
    "utf8",
  );
  assert.match(source, /Google product category/);
  assert.match(source, /Product type/);
  assert.match(source, /product\.productType \|\| "—"/);
  assert.match(source, /Error from multi-sync/);
  assert.match(
    source,
    /accessibilityLabel="Refresh product errors"[\s\S]*tone="critical"[\s\S]*variant="primary"/,
  );
  assert.match(
    styles,
    /\.errorHeader \{[\s\S]*width: 100%;[\s\S]*justify-content: space-between/,
  );
  assert.doesNotMatch(styles, /\.errorHeader s-button[\s\S]*transform: scale/);
  assert.match(source, /src: "\/correct\.png"/);
  assert.match(source, /src: "\/warning\.png"/);
  assert.match(source, /src: "\/cross\.png"/);
  assert.match(styles, /\.statusImage[\s\S]*width: 20px;[\s\S]*height: 20px;/);
  assert.match(source, /<img alt="Google" src="\/google-icon\.png" \/>/);
  assert.doesNotMatch(source, /SLVD_Navy\.png|time\.png|styles\.slvd/);
  assert.match(source, /<th colSpan=\{4\} scope="col">/);
  assert.match(source, /className=\{styles\.emptyCell\} colSpan=\{5\}/);
  assert.doesNotMatch(styles, /\.slvdColumn|\.slvdHeader|\.slvdCell|\.slvdTimeImage/);
  assert.match(source, /CollectionFilterPicker/);
  assert.match(source, /Search store collections/);
  assert.match(source, /Loading more collections/);
  assert.match(source, /onScroll=\{handleScroll\}/);
  assert.match(source, /\[cursor, debouncedSearch, open, query\.data\]/);
  assert.match(source, /<s-checkbox/);
  assert.match(
    source,
    /<colgroup>[\s\S]*styles\.productColumn[\s\S]*styles\.errorColumn/,
  );
  assert.match(styles, /\.diagnosticsTable[\s\S]*table-layout: fixed/);
  assert.match(styles, /font-size: 12px;[\s\S]*font-weight: 500/);
  assert.match(source, /Select all products/);
  assert.match(
    source,
    /styles\.selectionCount[\s\S]*Bulk edit selected products/,
  );
  assert.match(source, /Bulk edit/);
  assert.match(source, /Assign product type/);
  assert.match(source, /Assign custom_label_/);
  assert.match(source, /customLabelTargets/);
  assert.match(source, /is being added\./);
  assert.match(source, /Products displayed per page/);
  assert.match(source, /pageIndex \* pageSize \+ 1/);
  assert.doesNotMatch(source, /per page`/);
  assert.match(styles, /height: clamp\(490px, 68dvh, 730px\)/);
  assert.match(source, /Clear \$\{bulkEditField\}\?/);
  assert.match(source, /Leaving this field blank[\s\S]*erase/);
  assert.match(source, /diagnosticsKeys\.shop\(scope\.shop\)/);
  assert.doesNotMatch(source, /Product type update completed/);
  assert.doesNotMatch(source, /Updating selected products/);
});
