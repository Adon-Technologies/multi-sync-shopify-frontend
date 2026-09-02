import assert from "node:assert/strict";
import test from "node:test";

import { getShopCollectionProductIds } from "../app/services/collection-search.server.ts";

test("collection product membership follows every Shopify cursor page", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const admin = {
    graphql: async (
      _query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      const variables = options?.variables ?? {};
      requests.push(variables);
      const secondPage = variables.after === "next-page";

      return Response.json({
        data: {
          collection: {
            products: {
              nodes: [
                {
                  id: `gid://shopify/Product/${secondPage ? "3" : "1"}`,
                },
                ...(secondPage ? [] : [{ id: "gid://shopify/Product/2" }]),
              ],
              pageInfo: {
                endCursor: secondPage ? null : "next-page",
                hasNextPage: !secondPage,
              },
            },
          },
        },
      });
    },
  };

  const productIds = await getShopCollectionProductIds(
    admin,
    "collection-pagination-test.myshopify.com",
    "gid://shopify/Collection/123",
  );

  assert.deepEqual(productIds, [
    "gid://shopify/Product/1",
    "gid://shopify/Product/2",
    "gid://shopify/Product/3",
  ]);
  assert.deepEqual(
    requests.map(({ after }) => after),
    [null, "next-page"],
  );
});

test("invalid collection IDs never reach Shopify", async () => {
  let requested = false;
  const admin = {
    graphql: async () => {
      requested = true;
      return Response.json({ data: { collection: null } });
    },
  };

  assert.deepEqual(
    await getShopCollectionProductIds(
      admin,
      "invalid-collection-test.myshopify.com",
      "not-a-collection",
    ),
    [],
  );
  assert.equal(requested, false);
});
