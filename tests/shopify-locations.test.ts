import assert from "node:assert/strict";
import test from "node:test";

import {
  clearShopifyLocationCache,
  getActiveShopifyLocations,
  InventoryLocationVerificationError,
  verifySelectedInventoryLocations,
} from "../app/services/shopify-locations.server.ts";
import type { AdminGraphQLClient } from "../app/services/shopify-admin.server.ts";

function graphqlResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

test("active Shopify locations are paginated, cached, and isolated per store", async () => {
  let calls = 0;
  const admin: AdminGraphQLClient = {
    async graphql(_query, options) {
      calls += 1;
      const after = options?.variables?.after;
      return graphqlResponse({
        locations:
          after === null
            ? {
                nodes: [
                  {
                    id: "gid://shopify/Location/1",
                    isActive: true,
                    name: "Main",
                  },
                ],
                pageInfo: { endCursor: "next", hasNextPage: true },
              }
            : {
                nodes: [
                  {
                    id: "gid://shopify/Location/2",
                    isActive: true,
                    name: "Warehouse",
                  },
                ],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
      });
    },
  };

  clearShopifyLocationCache("store-a.myshopify.com");
  clearShopifyLocationCache("store-b.myshopify.com");

  const first = await getActiveShopifyLocations(
    admin,
    "store-a.myshopify.com",
  );
  const cached = await getActiveShopifyLocations(
    admin,
    "store-a.myshopify.com",
  );
  await getActiveShopifyLocations(admin, "store-b.myshopify.com");

  assert.deepEqual(first, cached);
  assert.deepEqual(
    first.map(({ id }) => id),
    ["gid://shopify/Location/1", "gid://shopify/Location/2"],
  );
  assert.equal(calls, 4);
});

test("new location IDs are shop-verified while unavailable saved IDs remain removable", async () => {
  let calls = 0;
  const admin: AdminGraphQLClient = {
    async graphql(_query, options) {
      calls += 1;
      const ids = (options?.variables?.ids ?? []) as string[];
      return graphqlResponse({
        nodes: ids.map((id) =>
          id.endsWith("/123")
            ? { id, isActive: true, name: "Main" }
            : null,
        ),
      });
    },
  };

  assert.deepEqual(
    await verifySelectedInventoryLocations(
      admin,
      ["gid://shopify/Location/123"],
      [],
    ),
    ["gid://shopify/Location/123"],
  );

  await assert.rejects(
    verifySelectedInventoryLocations(
      admin,
      ["gid://shopify/Location/999"],
      [],
    ),
    InventoryLocationVerificationError,
  );

  assert.deepEqual(
    await verifySelectedInventoryLocations(
      admin,
      ["gid://shopify/Location/999"],
      ["gid://shopify/Location/999"],
    ),
    ["gid://shopify/Location/999"],
  );
  assert.equal(calls, 2);
});
