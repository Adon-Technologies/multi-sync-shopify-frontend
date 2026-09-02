import { mergeProductTypeSuggestions } from "./product-type-suggestions.ts";
import {
  ShopifyAdminQueryError,
  type AdminGraphQLClient,
} from "./shopify-admin.server.ts";
import { normalizeShopDomain } from "./store-lifecycle.ts";

const SHOPIFY_PRODUCT_BATCH_SIZE = 250;
const PRODUCT_TYPES_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_SHOPS = 250;
const MAX_THROTTLE_RETRIES = 5;

const PRODUCT_TYPES_QUERY = `#graphql
  query ConfigurationProductTypes($after: String, $first: Int!) {
    products(after: $after, first: $first, sortKey: ID) {
      nodes {
        productType
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

interface ProductTypesQuery {
  products: {
    nodes: Array<{ productType: string }>;
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

interface ProductTypesCacheEntry {
  expiresAt: number;
  value: Promise<string[]>;
}

const productTypesCache = new Map<string, ProductTypesCacheEntry>();

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

async function queryProductTypesPage(
  admin: AdminGraphQLClient,
  after: string | null,
) {
  let attempt = 0;

  while (attempt <= MAX_THROTTLE_RETRIES) {
    const response = await admin.graphql(PRODUCT_TYPES_QUERY, {
      variables: { after, first: SHOPIFY_PRODUCT_BATCH_SIZE },
    });
    const payload =
      (await response.json()) as ShopifyGraphQLPayload<ProductTypesQuery>;
    const throttled = payload.errors?.some(
      (error) => error.extensions?.code === "THROTTLED",
    );

    if (response.ok && !payload.errors?.length && payload.data?.products) {
      return payload;
    }
    if (!throttled || attempt === MAX_THROTTLE_RETRIES) {
      throw new ShopifyAdminQueryError("Shopify did not return product types.");
    }

    attempt += 1;
    await wait(Math.max(250, throttleDelay(payload)));
  }

  throw new ShopifyAdminQueryError("Shopify did not return product types.");
}

async function discoverShopProductTypes(admin: AdminGraphQLClient) {
  const productTypes: string[] = [];
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

    const payload = await queryProductTypesPage(admin, after);
    const connection = payload.data?.products;
    if (!connection) {
      throw new ShopifyAdminQueryError("Shopify did not return product types.");
    }

    productTypes.push(
      ...connection.nodes.map(({ productType }) => productType),
    );
    hasNextPage = connection.pageInfo.hasNextPage;
    if (!hasNextPage) {
      break;
    }
    if (!connection.pageInfo.endCursor) {
      throw new ShopifyAdminQueryError(
        "Shopify returned incomplete product-type pagination.",
      );
    }

    after = connection.pageInfo.endCursor;
    previousPayload = payload;
  }

  return mergeProductTypeSuggestions(productTypes);
}

function pruneProductTypesCache() {
  const now = Date.now();
  for (const [shop, entry] of productTypesCache) {
    if (entry.expiresAt <= now) {
      productTypesCache.delete(shop);
    }
  }

  while (productTypesCache.size >= MAX_CACHED_SHOPS) {
    const oldestShop = productTypesCache.keys().next().value;
    if (!oldestShop) break;
    productTypesCache.delete(oldestShop);
  }
}

export function getShopProductTypes(admin: AdminGraphQLClient, shop: string) {
  const normalizedShop = normalizeShopDomain(shop);
  const cached = productTypesCache.get(normalizedShop);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (cached) {
    productTypesCache.delete(normalizedShop);
  }

  pruneProductTypesCache();
  const value = discoverShopProductTypes(admin).catch((error) => {
    if (productTypesCache.get(normalizedShop)?.value === value) {
      productTypesCache.delete(normalizedShop);
    }
    throw error;
  });
  productTypesCache.set(normalizedShop, {
    expiresAt: Date.now() + PRODUCT_TYPES_CACHE_TTL_MS,
    value,
  });
  return value;
}

export function clearShopProductTypesCache(shop?: string) {
  if (shop) {
    productTypesCache.delete(normalizeShopDomain(shop));
  } else {
    productTypesCache.clear();
  }
}
