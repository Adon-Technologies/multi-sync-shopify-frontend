import {
  normalizeConfigurationText,
  type SelectedCollection,
} from "./configuration-validation.ts";
import {
  queryShopifyAdmin,
  ShopifyAdminQueryError,
  type AdminGraphQLClient,
} from "./shopify-admin.server.ts";
import { buildCollectionSearch } from "./collection-search.ts";

const COLLECTION_SEARCH_LIMIT = 20;
const COLLECTION_LOOKUP_LIMIT = 250;
const COLLECTION_PRODUCTS_PAGE_SIZE = 250;
const COLLECTION_PRODUCTS_CACHE_TTL_MS = 2 * 60 * 1000;
const SHOPIFY_COLLECTION_ID = /^gid:\/\/shopify\/Collection\/\d+$/;
const COLLECTIONS_QUERY = `#graphql
  query ConfigurationCollections(
    $after: String
    $first: Int!
    $query: String
  ) {
    collections(
      after: $after
      first: $first
      query: $query
      sortKey: TITLE
    ) {
      nodes {
        id
        title
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

interface CollectionsQuery {
  collections: {
    nodes: SelectedCollection[];
    pageInfo: {
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
}

interface CollectionNodesQuery {
  nodes: Array<SelectedCollection | null>;
}

interface CollectionProductsQuery {
  collection: {
    products: {
      nodes: Array<{ id: string }>;
      pageInfo: {
        endCursor: string | null;
        hasNextPage: boolean;
      };
    };
  } | null;
}

interface CollectionProductsCacheEntry {
  expiresAt: number;
  value: Promise<string[]>;
}

const collectionProductsCache = new Map<string, CollectionProductsCacheEntry>();

export interface CollectionSearchPage {
  collections: SelectedCollection[];
  pageInfo: {
    endCursor: string | null;
    hasNextPage: boolean;
  };
  search: string;
}

export class CollectionVerificationError extends Error {
  constructor() {
    super(
      "One or more selected collections no longer belong to this Shopify store.",
    );
    this.name = "CollectionVerificationError";
  }
}

export async function searchShopCollections(
  admin: AdminGraphQLClient,
  searchValue: string | null,
  after: string | null,
): Promise<CollectionSearchPage> {
  const search = normalizeConfigurationText(searchValue ?? "").slice(0, 100);
  const data = await queryShopifyAdmin<CollectionsQuery>(
    admin,
    COLLECTIONS_QUERY,
    {
      after: after || null,
      first: COLLECTION_SEARCH_LIMIT,
      query: buildCollectionSearch(search),
    },
  );

  return {
    collections: data.collections.nodes,
    pageInfo: data.collections.pageInfo,
    search,
  };
}

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query DiagnosticCollectionProducts(
    $after: String
    $collectionId: ID!
    $first: Int!
  ) {
    collection(id: $collectionId) {
      products(after: $after, first: $first) {
        nodes {
          id
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

/**
 * Resolve collection membership once for a short window. Diagnostics pages
 * intersect these IDs with their immutable snapshot, so products outside the
 * current result set are discarded by the database query.
 */
export async function getShopCollectionProductIds(
  admin: AdminGraphQLClient,
  shop: string,
  collectionId: string,
) {
  if (!SHOPIFY_COLLECTION_ID.test(collectionId)) {
    return [];
  }

  const cacheKey = `${shop.trim().toLocaleLowerCase()}|${collectionId}`;
  const cached = collectionProductsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = (async () => {
    const productIds: string[] = [];
    let after: string | null = null;

    do {
      const data: CollectionProductsQuery =
        await queryShopifyAdmin<CollectionProductsQuery>(
          admin,
          COLLECTION_PRODUCTS_QUERY,
          {
            after,
            collectionId,
            first: COLLECTION_PRODUCTS_PAGE_SIZE,
          },
        );
      const collection = data.collection;
      if (!collection) {
        return [];
      }
      const page = collection.products;

      productIds.push(...page.nodes.map(({ id }) => id));
      if (!page.pageInfo.hasNextPage) {
        break;
      }
      if (!page.pageInfo.endCursor) {
        throw new ShopifyAdminQueryError(
          "Shopify stopped while loading collection products.",
        );
      }
      after = page.pageInfo.endCursor;
    } while (after);

    return productIds;
  })();

  collectionProductsCache.set(cacheKey, {
    expiresAt: Date.now() + COLLECTION_PRODUCTS_CACHE_TTL_MS,
    value,
  });

  try {
    return await value;
  } catch (error) {
    if (collectionProductsCache.get(cacheKey)?.value === value) {
      collectionProductsCache.delete(cacheKey);
    }
    throw error;
  }
}

const COLLECTION_NODES_QUERY = `#graphql
  query ConfigurationCollectionNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection {
        id
        title
      }
    }
  }
`;

export async function verifyShopCollections(
  admin: AdminGraphQLClient,
  collections: SelectedCollection[],
) {
  const verified = new Map<string, SelectedCollection>();

  for (
    let index = 0;
    index < collections.length;
    index += COLLECTION_LOOKUP_LIMIT
  ) {
    const page = collections.slice(index, index + COLLECTION_LOOKUP_LIMIT);
    const data = await queryShopifyAdmin<CollectionNodesQuery>(
      admin,
      COLLECTION_NODES_QUERY,
      { ids: page.map(({ id }) => id) },
    );

    for (const collection of data.nodes) {
      if (collection) verified.set(collection.id, collection);
    }
  }

  if (verified.size !== collections.length) {
    throw new CollectionVerificationError();
  }

  return collections.map(({ id }) => verified.get(id)!);
}
