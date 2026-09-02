import {
  normalizeDiagnosticsFilters,
  type DiagnosticsFilter,
} from "./diagnostics-filter.ts";
import { normalizeDiagnosticsSearch } from "./diagnostics-search.ts";
import type { DiagnosticsTab } from "./diagnostics.server";

export const MAX_PRODUCT_TYPE_LENGTH = 255;
export const MAX_CUSTOM_LABEL_LENGTH = 100;
export type CustomLabelIndex = 0 | 1 | 2 | 3 | 4;

export type DiagnosticsBulkEdit =
  | { kind: "productType"; value: string }
  | {
      index: CustomLabelIndex;
      kind: "customLabel";
      value: string;
    };

export interface DiagnosticsBulkSelectionScope {
  diagnosticsTab: DiagnosticsTab;
  filters: DiagnosticsFilter[];
  search: string;
  snapshotVersion: string;
}

export type DiagnosticsBulkSelection =
  | {
      mode: "explicit";
      productIds: Set<string>;
    }
  | {
      mode: "allMatching";
      excludedProductIds: Set<string>;
      scope: DiagnosticsBulkSelectionScope;
      totalCount: number;
    };

export interface DiagnosticsBulkEditRequest {
  edit: DiagnosticsBulkEdit;
  idempotencyKey: string;
  scope: DiagnosticsBulkSelectionScope;
  selection:
    | { mode: "explicit"; productIds: string[] }
    | { mode: "allMatching"; excludedProductIds: string[] };
}

export type DiagnosticsBulkEditJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED";

export interface DiagnosticsBulkEditJob {
  completedAt: string | null;
  createdAt: string;
  errorSamples: string[];
  failedCount: number;
  id: string;
  edit: DiagnosticsBulkEdit;
  processedCount: number;
  requestedCount: number;
  startedAt: string | null;
  status: DiagnosticsBulkEditJobStatus;
  successfulCount: number;
}

export function createDiagnosticsBulkSelectionScope({
  diagnosticsTab,
  filters,
  search,
  snapshotVersion,
}: DiagnosticsBulkSelectionScope): DiagnosticsBulkSelectionScope {
  return {
    diagnosticsTab,
    filters: normalizeDiagnosticsFilters(filters),
    search: normalizeDiagnosticsSearch(search),
    snapshotVersion,
  };
}

export function emptyDiagnosticsBulkSelection(): DiagnosticsBulkSelection {
  return { mode: "explicit", productIds: new Set() };
}

export function diagnosticsBulkSelectionCount(
  selection: DiagnosticsBulkSelection,
) {
  return selection.mode === "explicit"
    ? selection.productIds.size
    : Math.max(0, selection.totalCount - selection.excludedProductIds.size);
}

export function isDiagnosticsProductSelected(
  selection: DiagnosticsBulkSelection,
  productId: string,
) {
  return selection.mode === "explicit"
    ? selection.productIds.has(productId)
    : !selection.excludedProductIds.has(productId);
}

export function diagnosticsPageSelectionState(
  selection: DiagnosticsBulkSelection,
  productIds: string[],
) {
  const selectedCount = productIds.reduce(
    (count, productId) =>
      count + (isDiagnosticsProductSelected(selection, productId) ? 1 : 0),
    0,
  );

  return {
    checked: productIds.length > 0 && selectedCount === productIds.length,
    indeterminate: selectedCount > 0 && selectedCount < productIds.length,
    selectedCount,
  };
}

export function toggleDiagnosticsProduct(
  selection: DiagnosticsBulkSelection,
  productId: string,
  checked: boolean,
): DiagnosticsBulkSelection {
  if (selection.mode === "explicit") {
    const productIds = new Set(selection.productIds);
    if (checked) productIds.add(productId);
    else productIds.delete(productId);
    return { mode: "explicit", productIds };
  }

  const excludedProductIds = new Set(selection.excludedProductIds);
  if (checked) excludedProductIds.delete(productId);
  else excludedProductIds.add(productId);
  return { ...selection, excludedProductIds };
}

export function toggleDiagnosticsPage(
  selection: DiagnosticsBulkSelection,
  productIds: string[],
  checked: boolean,
): DiagnosticsBulkSelection {
  return productIds.reduce(
    (next, productId) => toggleDiagnosticsProduct(next, productId, checked),
    selection,
  );
}

export function selectAllMatchingDiagnosticsProducts(
  scope: DiagnosticsBulkSelectionScope,
  totalCount: number,
): DiagnosticsBulkSelection {
  return {
    mode: "allMatching",
    excludedProductIds: new Set(),
    scope: createDiagnosticsBulkSelectionScope(scope),
    totalCount: Math.max(0, totalCount),
  };
}

export function undoAllMatchingDiagnosticsProducts(
  selection: DiagnosticsBulkSelection,
  displayedProductIds: string[],
): DiagnosticsBulkSelection {
  if (selection.mode !== "allMatching") return selection;
  return {
    mode: "explicit",
    productIds: new Set(
      displayedProductIds.filter(
        (productId) => !selection.excludedProductIds.has(productId),
      ),
    ),
  };
}

export function serializeDiagnosticsBulkSelection(
  selection: DiagnosticsBulkSelection,
  scope: DiagnosticsBulkSelectionScope,
  edit: DiagnosticsBulkEdit,
  idempotencyKey: string,
): DiagnosticsBulkEditRequest {
  return {
    edit: { ...edit, value: edit.value.trim() },
    idempotencyKey,
    scope: createDiagnosticsBulkSelectionScope(
      selection.mode === "allMatching" ? selection.scope : scope,
    ),
    selection:
      selection.mode === "explicit"
        ? { mode: "explicit", productIds: [...selection.productIds] }
        : {
            mode: "allMatching",
            excludedProductIds: [...selection.excludedProductIds],
          },
  };
}
