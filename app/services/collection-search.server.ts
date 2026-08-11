import {
  normalizeConfigurationText,
  type SelectedCollection,
} from "./configuration-validation";
import {
  queryShopifyAdmin,
  type AdminGraphQLClient,
} from "./shopify-admin.server";
import { buildCollectionSearch } from "./collection-search";

const COLLECTION_SEARCH_LIMIT = 20;
const COLLECTION_LOOKUP_LIMIT = 250;
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
