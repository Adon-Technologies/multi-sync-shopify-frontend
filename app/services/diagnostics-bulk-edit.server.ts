import type { BulkProductTypeJob } from "@prisma/client";

import prisma from "../db.server";
import { getShopCollectionProductIds } from "./collection-search.server";
import {
  createDiagnosticsBulkSelectionScope,
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_PRODUCT_TYPE_LENGTH,
  type CustomLabelIndex,
  type DiagnosticsBulkEdit,
  type DiagnosticsBulkEditJob,
  type DiagnosticsBulkEditRequest,
} from "./diagnostics-bulk-edit";
import {
  normalizeDiagnosticsFilter,
  type DiagnosticsFilter,
} from "./diagnostics-filter";
import { buildDiagnosticsSnapshotProductWhere } from "./diagnostics-snapshot.server";
import type { DiagnosticsTab } from "./diagnostics.server";
import type { AdminGraphQLClient } from "./shopify-admin.server";
import { normalizeShopDomain } from "./store-lifecycle";

const validTabs = new Set<DiagnosticsTab>([
  "all",
  "submitted",
  "warnings",
  "excluded",
]);
const productIdPattern = /^gid:\/\/shopify\/Product\/\d+$/;
const idempotencyKeyPattern = /^[a-zA-Z0-9_-]{8,128}$/;

export class DiagnosticsBulkEditRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DiagnosticsBulkEditRequestError";
    this.status = status;
  }
}

function mapJob(job: BulkProductTypeJob): DiagnosticsBulkEditJob {
  return {
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    errorSamples: job.errorSamples.slice(0, 5),
    failedCount: job.failedCount,
    id: job.id,
    edit:
      job.action === "CUSTOM_LABEL"
        ? {
            index: job.customLabelIndex as CustomLabelIndex,
            kind: "customLabel",
            value: job.customLabelValue ?? "",
          }
        : { kind: "productType", value: job.productType },
    processedCount: job.processedCount,
    requestedCount: job.requestedCount,
    startedAt: job.startedAt?.toISOString() ?? null,
    status: job.status,
    successfulCount: job.successfulCount,
  };
}

function normalizeEdit(value: unknown): DiagnosticsBulkEdit {
  if (!value || typeof value !== "object") {
    throw new DiagnosticsBulkEditRequestError(
      "Choose a product field to edit.",
    );
  }
  const edit = value as Record<string, unknown>;
  const normalizedValue =
    typeof edit.value === "string" ? edit.value.trim() : "";

  if (edit.kind === "productType") {
    if (normalizedValue.length > MAX_PRODUCT_TYPE_LENGTH) {
      throw new DiagnosticsBulkEditRequestError(
        `Product type must be ${MAX_PRODUCT_TYPE_LENGTH} characters or fewer.`,
      );
    }
    return { kind: "productType", value: normalizedValue };
  }

  if (
    edit.kind === "customLabel" &&
    Number.isInteger(edit.index) &&
    Number(edit.index) >= 0 &&
    Number(edit.index) <= 4
  ) {
    if (normalizedValue.length > MAX_CUSTOM_LABEL_LENGTH) {
      throw new DiagnosticsBulkEditRequestError(
        `Custom label must be ${MAX_CUSTOM_LABEL_LENGTH} characters or fewer.`,
      );
    }
    return {
      index: Number(edit.index) as CustomLabelIndex,
      kind: "customLabel",
      value: normalizedValue,
    };
  }

  throw new DiagnosticsBulkEditRequestError(
    "The selected bulk edit field is invalid.",
  );
}

function normalizeProductIds(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    throw new DiagnosticsBulkEditRequestError(`${fieldName} must be a list.`);
  }

  const ids = [
    ...new Set(value.map((id) => (typeof id === "string" ? id.trim() : ""))),
  ];
  if (ids.some((id) => !productIdPattern.test(id))) {
    throw new DiagnosticsBulkEditRequestError(
      "The product selection contains an invalid Shopify product ID.",
    );
  }
  return ids;
}

function normalizeFilter(value: DiagnosticsFilter | null) {
  if (!value) return null;
  const filter = normalizeDiagnosticsFilter(value.field, value.value);
  if (!filter) {
    throw new DiagnosticsBulkEditRequestError(
      "The Diagnostics filter is invalid.",
    );
  }
  return filter;
}

async function requireAvailableStore(shop: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain: normalizeShopDomain(shop) },
    select: {
      accessStatus: true,
      id: true,
      shopDomain: true,
      status: true,
    },
  });

  if (
    !store ||
    store.status !== "INSTALLED" ||
    store.accessStatus !== "ACTIVE"
  ) {
    throw new DiagnosticsBulkEditRequestError(
      store?.accessStatus === "SUSPENDED"
        ? "This store has been suspended. Contact support for assistance."
        : "The Shopify store is not installed.",
      403,
    );
  }
  return store;
}

export async function getLatestDiagnosticsBulkEditJob(shop: string) {
  const store = await requireAvailableStore(shop);
  const job = await prisma.bulkProductTypeJob.findFirst({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
  });
  return job ? mapJob(job) : null;
}

export async function createDiagnosticsBulkEditJob(
  admin: AdminGraphQLClient,
  shop: string,
  request: DiagnosticsBulkEditRequest,
) {
  const store = await requireAvailableStore(shop);
  if (!idempotencyKeyPattern.test(request.idempotencyKey ?? "")) {
    throw new DiagnosticsBulkEditRequestError(
      "The bulk edit request identifier is invalid.",
    );
  }

  const existing = await prisma.bulkProductTypeJob.findUnique({
    where: {
      storeId_idempotencyKey: {
        idempotencyKey: request.idempotencyKey,
        storeId: store.id,
      },
    },
  });
  if (existing) return mapJob(existing);

  const edit = normalizeEdit(request.edit);

  if (!request.scope || !validTabs.has(request.scope.diagnosticsTab)) {
    throw new DiagnosticsBulkEditRequestError(
      "The Diagnostics selection scope is invalid.",
    );
  }
  const filter = normalizeFilter(request.scope.filter);
  const scope = createDiagnosticsBulkSelectionScope({
    ...request.scope,
    filter,
  });
  if (!scope.snapshotVersion) {
    throw new DiagnosticsBulkEditRequestError(
      "Refresh Diagnostics before starting a bulk edit.",
    );
  }

  const snapshot = await prisma.diagnosticsSnapshot.findUnique({
    where: {
      shop_scanVersion: {
        scanVersion: scope.snapshotVersion,
        shop: store.shopDomain,
      },
    },
    select: { status: true },
  });
  if (snapshot?.status !== "ready") {
    throw new DiagnosticsBulkEditRequestError(
      "The selected Diagnostics results are no longer available. Refresh and select the products again.",
      409,
    );
  }

  const activeJob = await prisma.bulkProductTypeJob.findFirst({
    where: {
      storeId: store.id,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (activeJob) {
    throw new DiagnosticsBulkEditRequestError(
      "Another catalog bulk edit is already in progress.",
      409,
    );
  }

  const collectionProductIds =
    scope.filter?.field === "collection"
      ? await getShopCollectionProductIds(admin, shop, scope.filter.value)
      : undefined;
  const scopeWhere = buildDiagnosticsSnapshotProductWhere({
    collectionProductIds,
    filter: scope.filter,
    scanVersion: scope.snapshotVersion,
    search: scope.search,
    shop: store.shopDomain,
    tab: scope.diagnosticsTab,
  });
  let productIds: string[] = [];
  let excludedProductIds: string[] = [];
  let requestedCount = 0;

  if (request.selection?.mode === "explicit") {
    productIds = normalizeProductIds(
      request.selection.productIds,
      "productIds",
    );
    if (productIds.length === 0) {
      throw new DiagnosticsBulkEditRequestError(
        "Select at least one product to edit.",
      );
    }
    requestedCount = await prisma.diagnosticsSnapshotProduct.count({
      where: { ...scopeWhere, productId: { in: productIds } },
    });
    if (requestedCount !== productIds.length) {
      throw new DiagnosticsBulkEditRequestError(
        "One or more selected products do not belong to this store or Diagnostics result set.",
        409,
      );
    }
  } else if (request.selection?.mode === "allMatching") {
    excludedProductIds = normalizeProductIds(
      request.selection.excludedProductIds,
      "excludedProductIds",
    );
    if (excludedProductIds.length > 0) {
      const validExclusions = await prisma.diagnosticsSnapshotProduct.count({
        where: {
          ...scopeWhere,
          productId: { in: excludedProductIds },
        },
      });
      if (validExclusions !== excludedProductIds.length) {
        throw new DiagnosticsBulkEditRequestError(
          "One or more exclusions do not belong to this Diagnostics result set.",
          409,
        );
      }
    }
    const matchingWhere = {
      ...scopeWhere,
      ...(excludedProductIds.length > 0
        ? { productId: { notIn: excludedProductIds } }
        : {}),
    };

    if (scope.filter?.field === "collection") {
      // Workers intentionally operate only on saved snapshot data. Preserve
      // the live Shopify collection intersection as an explicit, immutable
      // product list before the job is queued.
      const rows = await prisma.diagnosticsSnapshotProduct.findMany({
        where: matchingWhere,
        select: { productId: true },
      });
      productIds = rows.map(({ productId }) => productId);
      excludedProductIds = [];
      requestedCount = productIds.length;
    } else {
      requestedCount = await prisma.diagnosticsSnapshotProduct.count({
        where: matchingWhere,
      });
    }
    if (requestedCount === 0) {
      throw new DiagnosticsBulkEditRequestError(
        "No products remain in the selected Diagnostics result set.",
      );
    }
  } else {
    throw new DiagnosticsBulkEditRequestError(
      "The bulk product selection is invalid.",
    );
  }

  const job = await prisma.bulkProductTypeJob.create({
    data: {
      diagnosticsFilterField: scope.filter?.field ?? null,
      diagnosticsFilterValue: scope.filter?.value ?? null,
      diagnosticsSearch: scope.search,
      diagnosticsTab: scope.diagnosticsTab,
      excludedProductIds,
      idempotencyKey: request.idempotencyKey,
      productIds,
      action: edit.kind === "customLabel" ? "CUSTOM_LABEL" : "PRODUCT_TYPE",
      customLabelIndex: edit.kind === "customLabel" ? edit.index : null,
      customLabelValue: edit.kind === "customLabel" ? edit.value : null,
      productType: edit.kind === "productType" ? edit.value : "",
      requestedCount,
      selectionMode:
        request.selection.mode === "explicit" ||
        scope.filter?.field === "collection"
          ? "EXPLICIT"
          : "ALL_MATCHING",
      snapshotVersion: scope.snapshotVersion,
      storeId: store.id,
    },
  });
  return mapJob(job);
}
