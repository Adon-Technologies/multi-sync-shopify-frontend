import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import {
  type DiagnosticsFilter,
  type DiagnosticsFilterField,
  type DiagnosticsFilterOption,
} from "./diagnostics-filter";
import { normalizeDiagnosticsSearch } from "./diagnostics-search";
import {
  normalizeDiagnosticsSort,
  type DiagnosticsSort,
} from "./diagnostics-sort";
import {
  DIAGNOSTICS_CLASSIFICATION_VERSION,
  type DiagnosticProduct,
  type DiagnosticStatus,
  type DiagnosticWarning,
} from "./diagnostics-validation";

const READY_STATUS = "ready";
const BUILDING_STATUS = "building";
const SNAPSHOTS_TO_RETAIN = 2;
const SNAPSHOT_VERSION_PREFIX = `${DIAGNOSTICS_CLASSIFICATION_VERSION}:`;

export interface DiagnosticsSnapshotCounts {
  allProducts: number;
  submitted: number;
  warnings: number;
  excluded: number;
  configurationRevision: string;
  generatedAt: string;
  scanVersion: string;
}

export interface DiagnosticsSnapshotPage {
  products: DiagnosticProduct[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  scanVersion: string;
  totalProducts: number;
}

interface SnapshotProductInput {
  product: DiagnosticProduct;
  position: number;
}

export interface DiagnosticsSnapshotCursor {
  productId: string;
  scanVersion: string;
  position: number;
  offset?: number;
  sort?: DiagnosticsSort;
  shopifyCursor?: string;
}

function normalizeShop(shop: string) {
  return shop.trim().toLowerCase();
}

export function encodeDiagnosticsSnapshotCursor(
  cursor: DiagnosticsSnapshotCursor,
) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDiagnosticsSnapshotCursor(
  cursor?: string | null,
): DiagnosticsSnapshotCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<DiagnosticsSnapshotCursor>;

    if (
      typeof parsed.productId !== "string" ||
      typeof parsed.scanVersion !== "string" ||
      typeof parsed.position !== "number" ||
      !Number.isSafeInteger(parsed.position)
    ) {
      return null;
    }

    return {
      productId: parsed.productId,
      scanVersion: parsed.scanVersion,
      position: parsed.position,
      ...(typeof parsed.offset === "number" &&
      Number.isSafeInteger(parsed.offset) &&
      parsed.offset >= 0
        ? { offset: parsed.offset }
        : {}),
      ...(typeof parsed.sort === "string"
        ? { sort: normalizeDiagnosticsSort(parsed.sort) }
        : {}),
      ...(typeof parsed.shopifyCursor === "string"
        ? { shopifyCursor: parsed.shopifyCursor }
        : {}),
    };
  } catch {
    return null;
  }
}

function parseWarnings(value: Prisma.JsonValue): DiagnosticWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((warning) => {
    if (
      typeof warning === "object" &&
      warning !== null &&
      !Array.isArray(warning) &&
      typeof warning.code === "string" &&
      typeof warning.message === "string"
    ) {
      return [{ code: warning.code, message: warning.message }];
    }

    return [];
  });
}

function mapStoredProduct(product: {
  productId: string;
  title: string;
  productCreatedAt: Date;
  categoryName: string | null;
  genderValues: string[];
  ageValues: string[];
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  imageAlt: string | null;
  status: string;
  warningData: Prisma.JsonValue;
}): DiagnosticProduct {
  return {
    id: product.productId,
    title: product.title,
    createdAt: product.productCreatedAt.toISOString(),
    categoryName: product.categoryName,
    genderValues: product.genderValues,
    ageValues: product.ageValues,
    productType: product.productType,
    tags: product.tags,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    status:
      product.status === "submitted"
        ? "submitted"
        : product.status === "error"
          ? "error"
          : "warning",
    warnings: parseWarnings(product.warningData),
  };
}

function mapCounts(snapshot: {
  allProducts: number;
  submitted: number;
  warnings: number;
  excluded: number;
  completedAt: Date | null;
  configurationRevision: string;
  createdAt: Date;
  scanVersion: string;
}): DiagnosticsSnapshotCounts {
  return {
    allProducts: snapshot.allProducts,
    submitted: snapshot.submitted,
    warnings: snapshot.warnings,
    excluded: snapshot.excluded,
    configurationRevision: snapshot.configurationRevision,
    generatedAt: (snapshot.completedAt ?? snapshot.createdAt).toISOString(),
    scanVersion: snapshot.scanVersion,
  };
}

export async function findReadyDiagnosticsSnapshot(
  shop: string,
  scanVersion?: string | null,
) {
  if (scanVersion && !scanVersion.startsWith(SNAPSHOT_VERSION_PREFIX)) {
    return null;
  }

  const snapshot = await prisma.diagnosticsSnapshot.findFirst({
    where: {
      shop: normalizeShop(shop),
      status: READY_STATUS,
      scanVersion: scanVersion ?? { startsWith: SNAPSHOT_VERSION_PREFIX },
    },
    orderBy: {
      completedAt: "desc",
    },
  });

  return snapshot ? mapCounts(snapshot) : null;
}

export async function beginDiagnosticsSnapshot(
  shop: string,
  scanVersion: string,
  configurationRevision: string,
) {
  const normalizedShop = normalizeShop(shop);

  await prisma.diagnosticsSnapshotProduct.deleteMany({
    where: { shop: normalizedShop, scanVersion },
  });
  await prisma.diagnosticsSnapshot.deleteMany({
    where: { shop: normalizedShop, scanVersion, status: BUILDING_STATUS },
  });
  await prisma.diagnosticsSnapshot.create({
    data: {
      shop: normalizedShop,
      scanVersion,
      configurationRevision,
      status: BUILDING_STATUS,
    },
  });
}

export async function appendDiagnosticsSnapshotProducts(
  shop: string,
  scanVersion: string,
  inputs: SnapshotProductInput[],
) {
  if (inputs.length === 0) {
    return;
  }

  const normalizedShop = normalizeShop(shop);

  await prisma.diagnosticsSnapshotProduct.createMany({
    data: inputs.map(({ product, position }) => ({
      shop: normalizedShop,
      scanVersion,
      productId: product.id,
      position,
      title: product.title,
      productCreatedAt: new Date(product.createdAt),
      categoryName: product.categoryName,
      genderValues: product.genderValues,
      ageValues: product.ageValues,
      productType: product.productType,
      tags: product.tags,
      warningCodes: product.warnings.map(({ code }) => code),
      warningMessages: product.warnings.map(({ message }) => message),
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt,
      status: product.status,
      warningData: product.warnings.map(({ code, message }) => ({
        code,
        message,
      })) as Prisma.InputJsonValue,
    })),
  });
}

export async function completeDiagnosticsSnapshot(
  shop: string,
  scanVersion: string,
  counts: Omit<
    DiagnosticsSnapshotCounts,
    "configurationRevision" | "generatedAt" | "scanVersion"
  >,
) {
  const normalizedShop = normalizeShop(shop);
  const completedAt = new Date();

  const completion = await prisma.diagnosticsSnapshot.updateMany({
    where: {
      shop: normalizedShop,
      scanVersion,
      status: BUILDING_STATUS,
    },
    data: {
      ...counts,
      completedAt,
      status: READY_STATUS,
    },
  });

  if (completion.count !== 1) {
    throw new Error("Diagnostics snapshot became stale while it was building.");
  }

  const snapshot = await prisma.diagnosticsSnapshot.findUniqueOrThrow({
    where: {
      shop_scanVersion: {
        shop: normalizedShop,
        scanVersion,
      },
    },
  });

  // Cleanup must never turn an already completed snapshot into a failed scan.
  // A later refresh can retry pruning if this best-effort step fails.
  await pruneOldDiagnosticsSnapshots(normalizedShop).catch((error) => {
    console.error("Unable to prune old Diagnostics snapshots", error);
  });
  return mapCounts(snapshot);
}

export async function discardDiagnosticsSnapshot(
  shop: string,
  scanVersion: string,
) {
  const normalizedShop = normalizeShop(shop);

  await Promise.all([
    prisma.diagnosticsSnapshotProduct.deleteMany({
      where: { shop: normalizedShop, scanVersion },
    }),
    prisma.diagnosticsSnapshot.deleteMany({
      where: {
        shop: normalizedShop,
        scanVersion,
        status: BUILDING_STATUS,
      },
    }),
  ]);
}

async function pruneOldDiagnosticsSnapshots(shop: string) {
  const [snapshots, activeBulkEdits] = await Promise.all([
    prisma.diagnosticsSnapshot.findMany({
      where: { shop, status: READY_STATUS },
      orderBy: { completedAt: "desc" },
      select: { scanVersion: true },
    }),
    prisma.bulkProductTypeJob.findMany({
      where: {
        status: { in: ["QUEUED", "PROCESSING"] },
        store: { is: { shopDomain: normalizeShop(shop) } },
      },
      select: { snapshotVersion: true },
    }),
  ]);
  const protectedVersions = new Set(
    activeBulkEdits.map(({ snapshotVersion }) => snapshotVersion),
  );
  const obsoleteVersions = snapshots
    .slice(SNAPSHOTS_TO_RETAIN)
    .filter(({ scanVersion }) => !protectedVersions.has(scanVersion))
    .map((snapshot) => snapshot.scanVersion);

  if (obsoleteVersions.length === 0) {
    return;
  }

  await prisma.diagnosticsSnapshot.deleteMany({
    where: {
      shop,
      scanVersion: { in: obsoleteVersions },
    },
  });
  await prisma.diagnosticsSnapshotProduct.deleteMany({
    where: {
      shop,
      scanVersion: { in: obsoleteVersions },
    },
  });
}

export async function readDiagnosticsSnapshotPage(
  shop: string,
  tab: "all" | "submitted" | "warnings" | "excluded",
  options: {
    after?: string | null;
    before?: string | null;
    pageSize: number;
    scanVersion?: string | null;
    search?: string | null;
    sort?: DiagnosticsSort | string | null;
    filter?: DiagnosticsFilter | null;
  },
): Promise<DiagnosticsSnapshotPage | null> {
  const normalizedShop = normalizeShop(shop);
  const requestedCursor = options.before ?? options.after;
  const decodedCursor = decodeDiagnosticsSnapshotCursor(requestedCursor);

  if (requestedCursor && !decodedCursor) {
    return null;
  }

  const requestedVersion =
    options.scanVersion ?? decodedCursor?.scanVersion ?? null;
  const versionedSnapshot = requestedVersion
    ? await findReadyDiagnosticsSnapshot(normalizedShop, requestedVersion)
    : null;
  const snapshot =
    versionedSnapshot ??
    (!requestedVersion || requestedVersion.startsWith("shopify-")
      ? await findReadyDiagnosticsSnapshot(normalizedShop)
      : null);

  if (!snapshot) {
    return null;
  }

  const sort = normalizeDiagnosticsSort(options.sort);
  const isBackward = Boolean(options.before);
  const cursorOffset =
    decodedCursor?.sort === sort ? (decodedCursor.offset ?? null) : null;

  if (requestedCursor && cursorOffset === null) {
    return null;
  }

  const pageOffset = isBackward
    ? Math.max(0, cursorOffset! - options.pageSize)
    : cursorOffset === null
      ? 0
      : cursorOffset + 1;
  const sortDirection = sort.endsWith("-desc")
    ? ("desc" as const)
    : ("asc" as const);
  const orderBy =
    sort === "created-asc" || sort === "created-desc"
      ? [
          { productCreatedAt: sortDirection },
          { position: "asc" as const },
        ]
      : sort === "title-asc" || sort === "title-desc"
        ? [{ title: sortDirection }, { position: "asc" as const }]
        : [{ productType: sortDirection }, { position: "asc" as const }];
  const productWhere = buildDiagnosticsSnapshotProductWhere({
    filter: options.filter,
    scanVersion: snapshot.scanVersion,
    search: options.search,
    shop: normalizedShop,
    tab,
  });
  const [storedProducts, totalProducts] = await Promise.all([
    prisma.diagnosticsSnapshotProduct.findMany({
      where: productWhere,
      orderBy,
      skip: pageOffset,
      take: isBackward ? options.pageSize : options.pageSize + 1,
    }),
    prisma.diagnosticsSnapshotProduct.count({ where: productWhere }),
  ]);
  const hasExtraProduct = storedProducts.length > options.pageSize;
  const displayedRows = storedProducts.slice(0, options.pageSize);

  return {
    products: displayedRows.map(mapStoredProduct),
    pageInfo: {
      hasNextPage: isBackward ? Boolean(requestedCursor) : hasExtraProduct,
      hasPreviousPage: pageOffset > 0,
      startCursor: displayedRows[0]
        ? encodeDiagnosticsSnapshotCursor({
            productId: displayedRows[0].productId,
            scanVersion: snapshot.scanVersion,
            position: displayedRows[0].position,
            offset: pageOffset,
            sort,
          })
        : null,
      endCursor: displayedRows.at(-1)
        ? encodeDiagnosticsSnapshotCursor({
            productId: displayedRows.at(-1)!.productId,
            scanVersion: snapshot.scanVersion,
            position: displayedRows.at(-1)!.position,
            offset: pageOffset + displayedRows.length - 1,
            sort,
          })
        : null,
    },
    scanVersion: snapshot.scanVersion,
    totalProducts,
  };
}

function getDiagnosticsFilterWhere(
  filter?: DiagnosticsFilter | null,
): Prisma.DiagnosticsSnapshotProductWhereInput {
  if (!filter) {
    return {};
  }

  switch (filter.field) {
    case "merchant-error":
      return { warningCodes: { has: filter.value } };
    case "gender":
      return { genderValues: { has: filter.value } };
    case "age":
      return { ageValues: { has: filter.value } };
    case "google-product-category":
      return { categoryName: filter.value };
    case "product-type":
      return { productType: filter.value };
    case "tag":
      return { tags: { has: filter.value } };
  }
}

export function buildDiagnosticsSnapshotProductWhere({
  filter,
  scanVersion,
  search,
  shop,
  tab,
}: {
  filter?: DiagnosticsFilter | null;
  scanVersion: string;
  search?: string | null;
  shop: string;
  tab: "all" | "submitted" | "warnings" | "excluded";
}): Prisma.DiagnosticsSnapshotProductWhereInput {
  const status = getStatusForTab(tab);
  const normalizedSearch = normalizeDiagnosticsSearch(search ?? "");

  return {
    shop: normalizeShop(shop),
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
    ...getDiagnosticsFilterWhere(filter),
  };
}

function getStatusForTab(
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

function sortFilterOptions(options: DiagnosticsFilterOption[]) {
  return options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export async function readDiagnosticsSnapshotFilterOptions(
  shop: string,
  tab: "all" | "submitted" | "warnings" | "excluded",
  field: DiagnosticsFilterField,
  scanVersion?: string | null,
): Promise<DiagnosticsFilterOption[] | null> {
  const normalizedShop = normalizeShop(shop);
  const snapshot = await findReadyDiagnosticsSnapshot(
    normalizedShop,
    scanVersion,
  );

  if (!snapshot) {
    return null;
  }

  const status = getStatusForTab(tab);
  const rows = await prisma.diagnosticsSnapshotProduct.findMany({
    where: {
      shop: normalizedShop,
      scanVersion: snapshot.scanVersion,
      ...(status ? { status } : {}),
    },
    select: {
      ageValues: true,
      categoryName: true,
      genderValues: true,
      productType: true,
      tags: true,
      warningCodes: true,
      warningMessages: true,
    },
  });
  const options = new Map<string, DiagnosticsFilterOption>();

  for (const row of rows) {
    if (field === "merchant-error") {
      row.warningCodes.forEach((value, index) => {
        const label = row.warningMessages[index] ?? value;
        if (!options.has(value)) {
          options.set(value, { label, value });
        }
      });
      continue;
    }

    const values =
      field === "gender"
        ? row.genderValues
        : field === "age"
          ? row.ageValues
          : field === "google-product-category"
            ? row.categoryName
              ? [row.categoryName]
              : []
            : field === "product-type"
              ? row.productType
                ? [row.productType]
                : []
              : row.tags;

    for (const value of values) {
      if (!options.has(value)) {
        options.set(value, { label: value, value });
      }
    }
  }

  return sortFilterOptions([...options.values()]);
}
