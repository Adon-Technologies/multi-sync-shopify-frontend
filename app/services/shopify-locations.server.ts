import {
  normalizeInventoryLocationIds,
  type ConfigurationFieldErrors,
} from "./configuration-validation.ts";
import {
  queryShopifyAdmin,
  type AdminGraphQLClient,
} from "./shopify-admin.server.ts";
import { normalizeShopDomain } from "./store-lifecycle.ts";

const LOCATION_PAGE_SIZE = 250;
const LOCATION_CACHE_TTL_MS = 5 * 60 * 1_000;

const ACTIVE_LOCATIONS_QUERY = `#graphql
  query ConfigurationInventoryLocations($after: String, $first: Int!) {
    locations(
      after: $after
      first: $first
      includeInactive: false
      includeLegacy: false
      sortKey: NAME
    ) {
      nodes {
        id
        name
        isActive
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

const LOCATION_NODES_QUERY = `#graphql
  query ConfigurationInventoryLocationNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Location {
        id
        name
        isActive
      }
    }
  }
`;

interface LocationsQuery {
  locations: {
    nodes: ShopifyInventoryLocation[];
    pageInfo: {
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
}

interface LocationNodesQuery {
  nodes: Array<ShopifyInventoryLocation | null>;
}

export interface ShopifyInventoryLocation {
  id: string;
  isActive: boolean;
  name: string;
}

interface LocationCacheEntry {
  expiresAt: number;
  locations: ShopifyInventoryLocation[];
}

const locationCache = new Map<string, LocationCacheEntry>();
const locationRequests = new Map<
  string,
  Promise<ShopifyInventoryLocation[]>
>();

export class InventoryLocationVerificationError extends Error {
  readonly fields: ConfigurationFieldErrors;

  constructor() {
    super(
      "One or more selected inventory locations no longer belong to this Shopify store.",
    );
    this.name = "InventoryLocationVerificationError";
    this.fields = {
      selectedInventoryLocationIds:
        "Remove unavailable inventory locations and try again.",
    };
  }
}

async function fetchActiveShopifyLocations(admin: AdminGraphQLClient) {
  const locations: ShopifyInventoryLocation[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: LocationsQuery = await queryShopifyAdmin<LocationsQuery>(
      admin,
      ACTIVE_LOCATIONS_QUERY,
      {
        after,
        first: LOCATION_PAGE_SIZE,
      },
    );

    locations.push(
      ...data.locations.nodes.filter(({ isActive }) => isActive),
    );
    hasNextPage = data.locations.pageInfo.hasNextPage;
    after = data.locations.pageInfo.endCursor;

    if (hasNextPage && !after) {
      throw new Error("Shopify location pagination stopped unexpectedly.");
    }
  }

  return locations;
}

export async function getActiveShopifyLocations(
  admin: AdminGraphQLClient,
  shop: string,
) {
  const cacheKey = normalizeShopDomain(shop);
  const cached = locationCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.locations;
  }

  const pending = locationRequests.get(cacheKey);
  if (pending) return pending;

  const request = fetchActiveShopifyLocations(admin)
    .then((locations) => {
      locationCache.set(cacheKey, {
        expiresAt: Date.now() + LOCATION_CACHE_TTL_MS,
        locations,
      });
      return locations;
    })
    .finally(() => {
      locationRequests.delete(cacheKey);
    });

  locationRequests.set(cacheKey, request);
  return request;
}

/**
 * Newly submitted IDs must resolve to active Location nodes for the
 * authenticated shop. Previously saved IDs are allowed through so a merchant
 * can load and remove a location that Shopify has since deleted or deactivated.
 */
export async function verifySelectedInventoryLocations(
  admin: AdminGraphQLClient,
  selectedIdsValue: unknown,
  previouslySavedIdsValue: unknown,
) {
  const selectedIds = normalizeInventoryLocationIds(selectedIdsValue);
  const previouslySavedIds = new Set(
    normalizeInventoryLocationIds(previouslySavedIdsValue),
  );
  const idsToVerify = selectedIds.filter((id) => !previouslySavedIds.has(id));

  for (let index = 0; index < idsToVerify.length; index += LOCATION_PAGE_SIZE) {
    const ids = idsToVerify.slice(index, index + LOCATION_PAGE_SIZE);
    const data = await queryShopifyAdmin<LocationNodesQuery>(
      admin,
      LOCATION_NODES_QUERY,
      { ids },
    );
    const activeIds = new Set(
      data.nodes
        .filter(
          (location): location is ShopifyInventoryLocation =>
            Boolean(location?.isActive),
        )
        .map(({ id }) => id),
    );

    if (ids.some((id) => !activeIds.has(id))) {
      throw new InventoryLocationVerificationError();
    }
  }

  return selectedIds;
}

export function clearShopifyLocationCache(shop: string) {
  locationCache.delete(normalizeShopDomain(shop));
}
