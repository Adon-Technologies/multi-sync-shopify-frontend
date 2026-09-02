import assert from "node:assert/strict";
import test from "node:test";

import {
  clearShopProductTypesCache,
  getShopProductTypes,
} from "../app/services/product-type-discovery.server.ts";
import type { AdminGraphQLClient } from "../app/services/shopify-admin.server.ts";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("Shopify Product Type discovery paginates controlled product-only batches", async () => {
  clearShopProductTypesCache();
  const calls: Array<{
    query: string;
    variables?: Record<string, unknown>;
  }> = [];
  const admin: AdminGraphQLClient = {
    graphql: async (query, options) => {
      calls.push({ query, variables: options?.variables });
      const after = options?.variables?.after;
      return jsonResponse({
        data: {
          products:
            after === null
              ? {
                  nodes: [
                    { productType: " Shoes " },
                    { productType: "T-Shirts" },
                  ],
                  pageInfo: { endCursor: "page-2", hasNextPage: true },
                }
              : {
                  nodes: [
                    { productType: "shoes" },
                    { productType: "Accessories" },
                    { productType: "" },
                  ],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
        },
      });
    },
  };

  const values = await getShopProductTypes(admin, " Shop.MyShopify.com ");

  assert.deepEqual(values, ["Accessories", "Shoes", "T-Shirts"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ variables }) => variables),
    [
      { after: null, first: 250 },
      { after: "page-2", first: 250 },
    ],
  );
  assert.match(calls[0]!.query, /nodes\s*\{\s*productType\s*\}/);
  assert.doesNotMatch(calls[0]!.query, /variants|images|description|title/);
});

test("Shopify Product Type discovery coalesces requests and caches per store", async () => {
  clearShopProductTypesCache();
  let firstStoreCalls = 0;
  let secondStoreCalls = 0;
  const firstAdmin: AdminGraphQLClient = {
    graphql: async () => {
      firstStoreCalls += 1;
      return jsonResponse({
        data: {
          products: {
            nodes: [{ productType: "Shoes" }],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };
  const secondAdmin: AdminGraphQLClient = {
    graphql: async () => {
      secondStoreCalls += 1;
      return jsonResponse({
        data: {
          products: {
            nodes: [{ productType: "Electronics" }],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const [first, coalesced] = await Promise.all([
    getShopProductTypes(firstAdmin, "first.myshopify.com"),
    getShopProductTypes(firstAdmin, "FIRST.MYSHOPIFY.COM"),
  ]);
  const cached = await getShopProductTypes(firstAdmin, " first.myshopify.com ");
  const isolated = await getShopProductTypes(
    secondAdmin,
    "second.myshopify.com",
  );

  assert.deepEqual(first, ["Shoes"]);
  assert.deepEqual(coalesced, ["Shoes"]);
  assert.deepEqual(cached, ["Shoes"]);
  assert.deepEqual(isolated, ["Electronics"]);
  assert.equal(firstStoreCalls, 1);
  assert.equal(secondStoreCalls, 1);
});

test("a failed discovery is not retained in the store cache", async () => {
  clearShopProductTypesCache();
  let calls = 0;
  const admin: AdminGraphQLClient = {
    graphql: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ errors: [{ message: "Unavailable" }] });
      }
      return jsonResponse({
        data: {
          products: {
            nodes: [{ productType: "Recovered" }],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  await assert.rejects(
    getShopProductTypes(admin, "failure.myshopify.com"),
    /Shopify did not return product types/,
  );
  assert.deepEqual(await getShopProductTypes(admin, "failure.myshopify.com"), [
    "Recovered",
  ]);
  assert.equal(calls, 2);
});
