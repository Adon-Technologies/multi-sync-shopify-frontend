import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { diagnosticsFiltersQueryKey } from "../app/services/diagnostics-filter.ts";
import { buildDiagnosticsSnapshotProductWhere } from "../app/services/diagnostics-filter-where.ts";

const allRequestedFilters = [
  { field: "gender", value: "Men" },
  { field: "age", value: "Kids" },
  { field: "color", value: "Black" },
  { field: "size", value: "XL" },
  { field: "vendor", value: "Nike" },
  { field: "custom-label-0", value: "Best Selling" },
  { field: "custom-label-1", value: "Winter" },
  { field: "custom-label-2", value: "Sale" },
  { field: "custom-label-3", value: "Priority" },
  { field: "custom-label-4", value: "Google" },
] as const;

test("Gender, Age Group, Vendor, Color, Size, and custom_label_0..4 use AND predicates", () => {
  const where = buildDiagnosticsSnapshotProductWhere({
    filters: [...allRequestedFilters],
    scanVersion: "diagnostics-v14:scan-a",
    search: "shirt",
    shop: "Store-A.MyShopify.com",
    tab: "warnings",
  });

  assert.equal(where.shop, "store-a.myshopify.com");
  assert.equal(where.status, "warning");
  assert.deepEqual(where.title, {
    contains: "shirt",
    mode: "insensitive",
  });
  assert.deepEqual(where.AND, [
    { genderMatchValues: { has: "male" } },
    { ageMatchValues: { has: "kids" } },
    { colorMatchValues: { has: "black" } },
    { sizeMatchValues: { has: "xl" } },
    { vendor: { equals: "Nike", mode: "insensitive" } },
    { customLabel0MatchValues: { has: "best selling" } },
    { customLabel1MatchValues: { has: "winter" } },
    { customLabel2MatchValues: { has: "sale" } },
    { customLabel3MatchValues: { has: "priority" } },
    { customLabel4MatchValues: { has: "google" } },
  ]);
});

test("filters remain inside Submitted, Warnings, and Excluded result sets", () => {
  const statuses = {
    submitted: "submitted",
    warnings: "warning",
    excluded: "error",
  } as const;

  for (const [tab, status] of Object.entries(statuses)) {
    const where = buildDiagnosticsSnapshotProductWhere({
      filters: [{ field: "vendor", value: "Nike" }],
      scanVersion: "diagnostics-v14:scan-a",
      shop: "store-a.myshopify.com",
      tab: tab as keyof typeof statuses,
    });
    assert.equal(where.status, status);
    assert.deepEqual(where.AND, [
      { vendor: { equals: "Nike", mode: "insensitive" } },
    ]);
  }
});

test("collection and scalar filters are combined before snapshot pagination", () => {
  const where = buildDiagnosticsSnapshotProductWhere({
    collectionProductIds: ["gid://shopify/Product/1"],
    filters: [
      { field: "collection", value: "gid://shopify/Collection/2" },
      { field: "size", value: "M" },
    ],
    scanVersion: "diagnostics-v14:scan-a",
    shop: "store-a.myshopify.com",
    tab: "all",
  });
  assert.deepEqual(where.AND, [
    { sizeMatchValues: { has: "m" } },
    { productId: { in: ["gid://shopify/Product/1"] } },
  ]);

  const source = readFileSync(
    new URL("../app/services/diagnostics-snapshot.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const productWhere = buildDiagnosticsSnapshotProductWhere[\s\S]*where: productWhere,[\s\S]*skip: pageOffset/,
  );
});

test("equivalent filter order produces the same TanStack product query key", () => {
  const key = (
    filters: Array<{ field: "vendor" | "color"; value: string }>,
  ) => [
    "diagnostics",
    "store-a",
    "all",
    "shirt",
    diagnosticsFiltersQueryKey(filters),
  ];

  assert.deepEqual(
    key([
      { field: "vendor", value: "Nike" },
      { field: "color", value: "Black" },
    ]),
    key([
      { field: "color", value: "Black" },
      { field: "vendor", value: "Nike" },
    ]),
  );
});

test("CustomLabel enrichment is one store-isolated batch query and UI supports clear filters", () => {
  const serverSource = readFileSync(
    new URL("../app/services/diagnostics.server.ts", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL("../app/components/DiagnosticsPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    serverSource,
    /loadCustomLabelValuesForProducts[\s\S]*productId: \{ in: productIds \}[\s\S]*store: \{ is: \{ shopDomain: normalizeShop\(shop\) \} \}/,
  );
  const loader = serverSource.slice(
    serverSource.indexOf("async function loadCustomLabelValuesForProducts"),
    serverSource.indexOf("async function classifyProductEdges"),
  );
  assert.equal(loader.match(/customLabel\.findMany/g)?.length, 1);
  assert.doesNotMatch(loader, /for[\s\S]{0,120}customLabel\.findMany/);
  assert.match(panelSource, /Clear filters/);
  assert.match(panelSource, /setActiveFilters\(\[\]\)/);
  assert.match(panelSource, /storeClientState\(createDiagnosticsClientState/);
});

test("the filter popover keeps the original single-condition editor layout", () => {
  const panelSource = readFileSync(
    new URL("../app/components/DiagnosticsPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    panelSource,
    /Show all products where:[\s\S]*accessibilityLabel="Select a product filter"[\s\S]*<s-text>is<\/s-text>[\s\S]*<DiagnosticsFilterValuePicker/,
  );
  assert.match(panelSource, />\s*Add Filter\s*<\/s-button>/);
  assert.doesNotMatch(panelSource, /styles\.filterRows|styles\.filterRow/);
});
