import type { Prisma } from "@prisma/client";

import {
  normalizeDiagnosticsFilterMatchValue,
  normalizeDiagnosticsFilters,
  type DiagnosticsFilter,
} from "./diagnostics-filter.ts";
import { normalizeDiagnosticsSearch } from "./diagnostics-search.ts";
import type { DiagnosticStatus } from "./diagnostics-validation.ts";

function getDiagnosticsFilterWhere(
  filter: DiagnosticsFilter,
  collectionProductIds?: string[],
): Prisma.DiagnosticsSnapshotProductWhereInput {
  switch (filter.field) {
    case "merchant-error":
      return { warningCodes: { has: filter.value } };
    case "gender":
      return {
        genderMatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "age":
      return {
        ageMatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "color":
      return {
        colorMatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "size":
      return {
        sizeMatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "vendor":
      return { vendor: { equals: filter.value, mode: "insensitive" } };
    case "custom-label-0":
      return {
        customLabel0MatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "custom-label-1":
      return {
        customLabel1MatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "custom-label-2":
      return {
        customLabel2MatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "custom-label-3":
      return {
        customLabel3MatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "custom-label-4":
      return {
        customLabel4MatchValues: {
          has: normalizeDiagnosticsFilterMatchValue(filter.field, filter.value),
        },
      };
    case "google-product-category":
      return { categoryName: filter.value };
    case "product-type":
      return { productType: filter.value };
    case "collection":
      return { productId: { in: collectionProductIds ?? [] } };
    case "tag":
      return { tags: { has: filter.value } };
  }
}

export function getDiagnosticsStatusForTab(
  tab: "all" | "submitted" | "warnings" | "excluded",
): DiagnosticStatus | undefined {
  return tab === "submitted"
    ? "submitted"
    : tab === "warnings"
      ? "warning"
      : tab === "excluded"
        ? "error"
        : undefined;
}

export function buildDiagnosticsSnapshotProductWhere({
  collectionProductIds,
  filters,
  scanVersion,
  search,
  shop,
  tab,
}: {
  collectionProductIds?: string[];
  filters?: DiagnosticsFilter[];
  scanVersion: string;
  search?: string | null;
  shop: string;
  tab: "all" | "submitted" | "warnings" | "excluded";
}): Prisma.DiagnosticsSnapshotProductWhereInput {
  const status = getDiagnosticsStatusForTab(tab);
  const normalizedSearch = normalizeDiagnosticsSearch(search ?? "");
  const filterConditions = normalizeDiagnosticsFilters(filters).map((filter) =>
    getDiagnosticsFilterWhere(filter, collectionProductIds),
  );

  return {
    shop: shop.trim().toLowerCase(),
    scanVersion,
    ...(status ? { status } : {}),
    ...(normalizedSearch
      ? {
          title: {
            contains: normalizedSearch,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(filterConditions.length > 0 ? { AND: filterConditions } : {}),
  };
}
