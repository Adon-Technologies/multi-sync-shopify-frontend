import assert from "node:assert/strict";
import test from "node:test";

import {
  clearShopProductTagsCache,
  getShopProductTags,
} from "../app/services/product-tag-discovery.server.ts";
import type { AdminGraphQLClient } from "../app/services/shopify-admin.server.ts";

test("tag discovery retries Shopify throttling and rejects broken pagination", async () => {
  clearShopProductTagsCache();
  let calls = 0;
  const admin: AdminGraphQLClient = {
    graphql: async () => {
      calls += 1;
      return jsonResponse(
        calls === 1
          ? {
              errors: [
                { message: "Throttled", extensions: { code: "THROTTLED" } },
              ],
            }
          : {
              data: {
                productTags: {
                  nodes: ["Sale"],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
      );
    },
  };
  assert.deepEqual(await getShopProductTags(admin, "throttled.myshopify.com"), [
    "Sale",
  ]);
  assert.equal(calls, 2);
  for (const endCursor of [null, "repeated"]) {
    const broken: AdminGraphQLClient = {
      graphql: async () =>
        jsonResponse({
          data: {
            productTags: {
              nodes: [],
              pageInfo: { hasNextPage: true, endCursor },
            },
          },
        }),
    };
    await assert.rejects(
      getShopProductTags(broken, "broken.myshopify.com"),
      /pagination/,
    );
  }
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("Shopify Product Tag discovery paginates controlled tag-only batches", async () => {
  clearShopProductTagsCache();
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
          productTags:
            after === null
              ? {
                  nodes: [" Shoes ", "T-Shirts"],
                  pageInfo: { endCursor: "page-2", hasNextPage: true },
                }
              : {
                  nodes: ["shoes", "Accessories", ""],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
        },
      });
    },
  };

  const values = await getShopProductTags(admin, " Shop.MyShopify.com ");

  assert.deepEqual(values, ["Accessories", "Shoes", "T-Shirts"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ variables }) => variables),
    [
      { after: null, first: 1000 },
      { after: "page-2", first: 1000 },
    ],
  );
  assert.match(
    calls[0]!.query,
    /productTags\(after: \$after, first: \$first\)/,
  );
  assert.doesNotMatch(
    calls[0]!.query,
    /products\(|variants|images|description|title/,
  );
});

test("Shopify Product Tag discovery coalesces requests and caches per store", async () => {
  clearShopProductTagsCache();
  let firstStoreCalls = 0;
  let secondStoreCalls = 0;
  const firstAdmin: AdminGraphQLClient = {
    graphql: async () => {
      firstStoreCalls += 1;
      return jsonResponse({
        data: {
          productTags: {
            nodes: ["Shoes"],
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
          productTags: {
            nodes: ["Electronics"],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  const [first, coalesced] = await Promise.all([
    getShopProductTags(firstAdmin, "first.myshopify.com"),
    getShopProductTags(firstAdmin, "FIRST.MYSHOPIFY.COM"),
  ]);
  const cached = await getShopProductTags(firstAdmin, " first.myshopify.com ");
  const isolated = await getShopProductTags(
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
  clearShopProductTagsCache();
  let calls = 0;
  const admin: AdminGraphQLClient = {
    graphql: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ errors: [{ message: "Unavailable" }] });
      }
      return jsonResponse({
        data: {
          productTags: {
            nodes: ["Recovered"],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    },
  };

  await assert.rejects(
    getShopProductTags(admin, "failure.myshopify.com"),
    /Shopify did not return product tags/,
  );
  assert.deepEqual(await getShopProductTags(admin, "failure.myshopify.com"), [
    "Recovered",
  ]);
  assert.equal(calls, 2);
});
