import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteShopifySessionsForShop,
  type ShopifySessionCleanupStorage,
} from "../app/services/shopify-session-cleanup.ts";

test("uninstall cleanup deletes every Shopify session for the normalized shop", async () => {
  const calls: string[] = [];
  const storage: ShopifySessionCleanupStorage = {
    async findSessionsByShop(shop) {
      calls.push(`find:${shop}`);
      return [{ id: "offline_shop" }, { id: "online_shop_user" }];
    },
    async deleteSessions(ids) {
      calls.push(`delete:${ids.join(",")}`);
      return true;
    },
  };

  const deleted = await deleteShopifySessionsForShop(
    " Adon-Test-1.myshopify.com ",
    storage,
  );

  assert.equal(deleted, 2);
  assert.deepEqual(calls, [
    "find:adon-test-1.myshopify.com",
    "delete:offline_shop,online_shop_user",
  ]);
});

test("repeated uninstall cleanup succeeds when no Shopify sessions remain", async () => {
  let deleteCalls = 0;
  const storage: ShopifySessionCleanupStorage = {
    async findSessionsByShop() {
      return [];
    },
    async deleteSessions() {
      deleteCalls += 1;
      return true;
    },
  };

  const deleted = await deleteShopifySessionsForShop(
    "adon-test-1.myshopify.com",
    storage,
  );

  assert.equal(deleted, 0);
  assert.equal(deleteCalls, 0);
});
