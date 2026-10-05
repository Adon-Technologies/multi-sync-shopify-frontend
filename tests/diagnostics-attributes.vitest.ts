import { beforeEach, expect, it, vi } from "vitest";
import {
  createDiagnosticsBulkEditJob,
  getLatestDiagnosticsBulkEditJob,
} from "../app/services/diagnostics-bulk-edit.server";
import type { DiagnosticsBulkEditRequest } from "../app/services/diagnostics-bulk-edit";

const db = vi.hoisted(() => ({
  store: { findUnique: vi.fn() },
  bulkProductTypeJob: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  diagnosticsSnapshot: { findUnique: vi.fn() },
  diagnosticsSnapshotProduct: { count: vi.fn(), findMany: vi.fn() },
}));
const collections = vi.hoisted(() => vi.fn());
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/collection-search.server", () => ({
  getShopCollectionProductIds: collections,
}));
const admin = {
  graphql: vi.fn(async () => {
    throw new Error("The request must queue, never mutate Shopify");
  }),
};
function request(
  kind = "gender",
  value = "male",
  count = 1,
): DiagnosticsBulkEditRequest {
  return {
    edit: { kind, value } as DiagnosticsBulkEditRequest["edit"],
    idempotencyKey: "request-12345",
    scope: {
      diagnosticsTab: "warnings",
      snapshotVersion: "scan",
      filters: [],
      search: "shoe",
    },
    selection: {
      mode: "explicit",
      productIds: Array.from(
        { length: count },
        (_, i) => `gid://shopify/Product/${i + 1}`,
      ),
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  db.store.findUnique.mockResolvedValue({
    id: "store",
    shopDomain: "test.myshopify.com",
    status: "INSTALLED",
    accessStatus: "ACTIVE",
  });
  db.bulkProductTypeJob.findUnique.mockResolvedValue(null);
  db.bulkProductTypeJob.findFirst.mockResolvedValue(null);
  db.diagnosticsSnapshot.findUnique.mockResolvedValue({ status: "ready" });
  db.diagnosticsSnapshotProduct.count.mockImplementation(
    async ({ where }) => where.productId?.in?.length ?? 1500,
  );
  db.bulkProductTypeJob.create.mockImplementation(async ({ data }) => ({
    ...data,
    id: "job",
    createdAt: new Date(),
    completedAt: null,
    startedAt: null,
    errorSamples: [],
    failedCount: 0,
    processedCount: 0,
    successfulCount: 0,
    status: "QUEUED",
  }));
});
for (const [kind, action, values] of [
  ["gender", "GENDER", ["male", "female", "unisex"]],
  ["ageGroup", "AGE_GROUP", ["adult", "infant", "kids", "toddler", "newborn"]],
] as const) {
  for (const value of values)
    it(`queues ${kind} ${value} and maps it in progress responses without request-time Shopify writes`, async () => {
      const result = await createDiagnosticsBulkEditJob(
        admin,
        "test.myshopify.com",
        request(kind, value, 3),
      );
      expect(result.edit).toEqual({ kind, value });
      expect(result.status).toBe("QUEUED");
      expect(result.requestedCount).toBe(3);
      expect(db.bulkProductTypeJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action,
          attributeValue: value,
          productType: "",
          customLabelValue: null,
          selectionMode: "EXPLICIT",
        }),
      });
      expect(admin.graphql).not.toHaveBeenCalled();
    });
  for (const value of ["", "Men", "Women", "Kid", "ADULT", "unsupported"])
    it(`rejects noncanonical ${kind} '${value}' before queueing`, async () => {
      await expect(
        createDiagnosticsBulkEditJob(
          admin,
          "test.myshopify.com",
          request(kind, value),
        ),
      ).rejects.toThrow("Choose a supported");
      expect(db.bulkProductTypeJob.create).not.toHaveBeenCalled();
      expect(admin.graphql).not.toHaveBeenCalled();
    });
  it(`${kind} Select all preserves the saved scope and exclusions instead of browser page IDs`, async () => {
    const input = request(kind, values[0]);
    input.scope.filters = [{ field: "vendor", value: "Acme" }];
    input.selection = {
      mode: "allMatching",
      excludedProductIds: ["gid://shopify/Product/5"],
    };
    db.diagnosticsSnapshotProduct.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1499);
    const result = await createDiagnosticsBulkEditJob(
      admin,
      "test.myshopify.com",
      input,
    );
    expect(result.requestedCount).toBe(1499);
    expect(db.bulkProductTypeJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        selectionMode: "ALL_MATCHING",
        productIds: [],
        excludedProductIds: input.selection.excludedProductIds,
        diagnosticsFilters: input.scope.filters,
        diagnosticsSearch: "shoe",
        snapshotVersion: "scan",
      }),
    });
  });
}
it("collection Select all materializes the server-side collection intersection for the worker", async () => {
  const input = request("ageGroup", "kids");
  input.scope.filters = [
    { field: "collection", value: "gid://shopify/Collection/1" },
  ];
  input.selection = { mode: "allMatching", excludedProductIds: [] };
  collections.mockResolvedValue(
    new Set(["gid://shopify/Product/1", "gid://shopify/Product/2"]),
  );
  db.diagnosticsSnapshotProduct.findMany.mockResolvedValue([
    { productId: "gid://shopify/Product/1" },
    { productId: "gid://shopify/Product/2" },
  ]);
  const result = await createDiagnosticsBulkEditJob(
    admin,
    "test.myshopify.com",
    input,
  );
  expect(result.requestedCount).toBe(2);
  expect(db.bulkProductTypeJob.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      selectionMode: "EXPLICIT",
      productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
    }),
  });
});
it("idempotent requests return the same saved attribute job without creating another", async () => {
  const saved = await createDiagnosticsBulkEditJob(
    admin,
    "test.myshopify.com",
    request(),
  );
  const created = db.bulkProductTypeJob.create.mock.results[0].value;
  db.bulkProductTypeJob.findUnique.mockResolvedValue(await created);
  const repeated = await createDiagnosticsBulkEditJob(
    admin,
    "test.myshopify.com",
    request(),
  );
  expect(repeated.id).toBe(saved.id);
  expect(db.bulkProductTypeJob.create).toHaveBeenCalledTimes(1);
});
it("rejects cross-store product IDs, stale snapshots, empty selection and concurrent active jobs", async () => {
  db.diagnosticsSnapshotProduct.count.mockResolvedValueOnce(0);
  await expect(
    createDiagnosticsBulkEditJob(admin, "test.myshopify.com", request()),
  ).rejects.toThrow("do not belong");
  db.diagnosticsSnapshot.findUnique.mockResolvedValueOnce({ status: "stale" });
  await expect(
    createDiagnosticsBulkEditJob(admin, "test.myshopify.com", request()),
  ).rejects.toThrow("no longer available");
  await expect(
    createDiagnosticsBulkEditJob(
      admin,
      "test.myshopify.com",
      request("gender", "male", 0),
    ),
  ).rejects.toThrow("Select at least one");
  db.bulkProductTypeJob.findFirst.mockResolvedValueOnce({ id: "active" });
  await expect(
    createDiagnosticsBulkEditJob(admin, "test.myshopify.com", request()),
  ).rejects.toThrow("already in progress");
  expect(db.bulkProductTypeJob.create).not.toHaveBeenCalled();
});
it("latest status maps partial attribute results and error samples", async () => {
  await createDiagnosticsBulkEditJob(
    admin,
    "test.myshopify.com",
    request("ageGroup", "newborn", 3),
  );
  const job = await db.bulkProductTypeJob.create.mock.results[0].value;
  db.bulkProductTypeJob.findFirst.mockResolvedValue({
    ...job,
    status: "PARTIALLY_COMPLETED",
    successfulCount: 2,
    failedCount: 1,
    errorSamples: ["Not allowed"],
  });
  expect(
    await getLatestDiagnosticsBulkEditJob("test.myshopify.com"),
  ).toMatchObject({
    edit: { kind: "ageGroup", value: "newborn" },
    status: "PARTIALLY_COMPLETED",
    successfulCount: 2,
    failedCount: 1,
    errorSamples: ["Not allowed"],
  });
});
it("existing Product Type and Custom Label job payloads remain unchanged", async () => {
  await createDiagnosticsBulkEditJob(
    admin,
    "test.myshopify.com",
    request("productType", "Shoes"),
  );
  expect(db.bulkProductTypeJob.create).toHaveBeenLastCalledWith({
    data: expect.objectContaining({
      action: "PRODUCT_TYPE",
      productType: "Shoes",
      attributeValue: null,
    }),
  });
  const input = request();
  input.edit = { kind: "customLabel", index: 3, value: "Sale" };
  await createDiagnosticsBulkEditJob(admin, "test.myshopify.com", input);
  expect(db.bulkProductTypeJob.create).toHaveBeenLastCalledWith({
    data: expect.objectContaining({
      action: "CUSTOM_LABEL",
      productType: "",
      customLabelIndex: 3,
      customLabelValue: "Sale",
      attributeValue: null,
    }),
  });
});

it("concurrent submissions with the same idempotency key return the single winning job", async () => {
  await createDiagnosticsBulkEditJob(admin, "test.myshopify.com", request());
  const winning = await db.bulkProductTypeJob.create.mock.results[0].value;
  db.bulkProductTypeJob.create.mockRejectedValueOnce({ code: "P2002" });
  db.bulkProductTypeJob.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(winning);
  const repeated = await createDiagnosticsBulkEditJob(
    admin,
    "test.myshopify.com",
    request(),
  );
  expect(repeated.id).toBe(winning.id);
});
it("attribute definition and access errors are exposed in the status response", async () => {
  await createDiagnosticsBulkEditJob(admin, "test.myshopify.com", request());
  const saved = await db.bulkProductTypeJob.create.mock.results[0].value;
  db.bulkProductTypeJob.findFirst.mockResolvedValue({
    ...saved,
    status: "FAILED",
    lastError: "custom.gender must use the single-line text type",
    errorSamples: [],
  });
  expect(
    (await getLatestDiagnosticsBulkEditJob("test.myshopify.com"))?.errorSamples,
  ).toEqual(["custom.gender must use the single-line text type"]);
});
