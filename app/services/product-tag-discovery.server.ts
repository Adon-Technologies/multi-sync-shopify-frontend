import { normalizeExcludedProductTags } from "@multi-sync/catalog-rules";
import {
  ShopifyAdminQueryError,
  type AdminGraphQLClient,
} from "./shopify-admin.server.ts";
import { normalizeShopDomain } from "./store-lifecycle.ts";

const SHOPIFY_PRODUCT_BATCH_SIZE = 1000;
const PRODUCT_TAGS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_SHOPS = 250;
const MAX_THROTTLE_RETRIES = 5;

const PRODUCT_TAGS_QUERY = `#graphql
  query ConfigurationProductTags($after: String, $first: Int!) {
    productTags(after: $after, first: $first) {
      nodes
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

interface ProductTagsQuery {
  productTags: {
    nodes: string[];
    pageInfo: {
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
}

interface ShopifyGraphQLError {
  extensions?: { code?: string };
  message: string;
}

interface ShopifyGraphQLPayload<TData> {
  data?: TData;
  errors?: ShopifyGraphQLError[];
  extensions?: {
    cost?: {
      actualQueryCost?: number;
      requestedQueryCost?: number;
      throttleStatus?: {
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

interface ProductTagsCacheEntry {
  expiresAt: number;
  value: Promise<string[]>;
}

const productTagsCache = new Map<string, ProductTagsCacheEntry>();

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function throttleDelay(payload: ShopifyGraphQLPayload<unknown>) {
  const cost = payload.extensions?.cost;
  const throttle = cost?.throttleStatus;
  if (!cost || !throttle || throttle.restoreRate <= 0) {
    return 0;
  }

  const nextCost =
    cost.requestedQueryCost ??
    cost.actualQueryCost ??
    SHOPIFY_PRODUCT_BATCH_SIZE;
  const deficit = Math.max(0, nextCost - throttle.currentlyAvailable);
  return deficit > 0
    ? Math.min(10_000, Math.ceil((deficit / throttle.restoreRate) * 1000))
    : 0;
}

async function queryProductTagsPage(
  admin: AdminGraphQLClient,
  after: string | null,
) {
  let attempt = 0;

  while (attempt <= MAX_THROTTLE_RETRIES) {
    const response = await admin.graphql(PRODUCT_TAGS_QUERY, {
      variables: { after, first: SHOPIFY_PRODUCT_BATCH_SIZE },
    });
    const payload =
      (await response.json()) as ShopifyGraphQLPayload<ProductTagsQuery>;
    const throttled = payload.errors?.some(
      (error) => error.extensions?.code === "THROTTLED",
    );

    if (response.ok && !payload.errors?.length && payload.data?.productTags) {
      return payload;
    }
    if (!throttled || attempt === MAX_THROTTLE_RETRIES) {
      throw new ShopifyAdminQueryError("Shopify did not return product tags.");
    }

    attempt += 1;
    await wait(Math.max(250, throttleDelay(payload)));
  }

  throw new ShopifyAdminQueryError("Shopify did not return product tags.");
}

async function discoverShopProductTags(admin: AdminGraphQLClient) {
  const productTags: string[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  let previousPayload: ShopifyGraphQLPayload<unknown> | null = null;

  while (hasNextPage) {
    if (previousPayload) {
      const delay = throttleDelay(previousPayload);
      if (delay > 0) {
        await wait(delay);
      }
    }

    const payload = await queryProductTagsPage(admin, after);
    const connection = payload.data?.productTags;
    if (!connection) {
      throw new ShopifyAdminQueryError("Shopify did not return product tags.");
    }

    productTags.push(...connection.nodes);
    hasNextPage = connection.pageInfo.hasNextPage;
    if (!hasNextPage) {
      break;
    }
    if (
      !connection.pageInfo.endCursor ||
      connection.pageInfo.endCursor === after
    ) {
      throw new ShopifyAdminQueryError(
        "Shopify returned incomplete product-tag pagination.",
      );
    }

    after = connection.pageInfo.endCursor;
    previousPayload = payload;
  }

  return normalizeExcludedProductTags(productTags).sort((a, b) =>
    a.localeCompare(b),
  );
}

function pruneProductTagsCache() {
  const now = Date.now();
  for (const [shop, entry] of productTagsCache) {
    if (entry.expiresAt <= now) {
      productTagsCache.delete(shop);
    }
  }

  while (productTagsCache.size >= MAX_CACHED_SHOPS) {
    const oldestShop = productTagsCache.keys().next().value;
    if (!oldestShop) break;
    productTagsCache.delete(oldestShop);
  }
}

export function getShopProductTags(admin: AdminGraphQLClient, shop: string) {
  const normalizedShop = normalizeShopDomain(shop);
  const cached = productTagsCache.get(normalizedShop);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (cached) {
    productTagsCache.delete(normalizedShop);
  }

  pruneProductTagsCache();
  const value = discoverShopProductTags(admin).catch((error) => {
    if (productTagsCache.get(normalizedShop)?.value === value) {
      productTagsCache.delete(normalizedShop);
    }
    throw error;
  });
  productTagsCache.set(normalizedShop, {
    expiresAt: Date.now() + PRODUCT_TAGS_CACHE_TTL_MS,
    value,
  });
  return value;
}

export function clearShopProductTagsCache(shop?: string) {
  if (shop) {
    productTagsCache.delete(normalizeShopDomain(shop));
  } else {
    productTagsCache.clear();
  }
}
