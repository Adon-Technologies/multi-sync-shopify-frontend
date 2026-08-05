import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstalledStoreUpdate,
  buildStoreTokenUpdate,
  buildUninstalledStoreUpdate,
  canSyncStoreFromSession,
  normalizeShopDomain,
} from "../app/services/store-lifecycle.ts";

test("shop domains normalize to isolated stable keys", () => {
  const firstShop = normalizeShopDomain(" First-Shop.myshopify.com ");
  const secondShop = normalizeShopDomain("second-shop.myshopify.com");

  assert.equal(firstShop, "first-shop.myshopify.com");
  assert.equal(secondShop, "second-shop.myshopify.com");
  assert.notEqual(firstShop, secondShop);
});

test("reinstall restores status, token, install date, and configuration identity", () => {
  const reinstalledAt = new Date("2026-07-23T10:00:00.000Z");
  const update = buildInstalledStoreUpdate(
    "UNINSTALLED",
    "new-access-token",
    reinstalledAt,
  );

  assert.deepEqual(update, {
    accessToken: "new-access-token",
    status: "INSTALLED",
    uninstalledAt: null,
    installedAt: reinstalledAt,
  });
  assert.equal("configuration" in update, false);
});

test("stale sessions cannot reactivate an uninstalled store outside authentication", () => {
  assert.equal(canSyncStoreFromSession("UNINSTALLED"), false);
  assert.equal(canSyncStoreFromSession("UNINSTALLED", true), true);
  assert.equal(canSyncStoreFromSession("INSTALLED"), true);
});

test("uninstall invalidates the token without deleting the record", () => {
  const uninstalledAt = new Date("2026-07-23T11:00:00.000Z");

  assert.deepEqual(buildUninstalledStoreUpdate(uninstalledAt), {
    accessToken: null,
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    status: "UNINSTALLED",
    tokenRefreshLockId: null,
    tokenRefreshLockedAt: null,
    uninstalledAt,
  });
});

test("newer Shopify session tokens replace older background-worker tokens", () => {
  const update = buildStoreTokenUpdate(
    {
      accessToken: "old-access",
      accessTokenExpiresAt: new Date("2026-07-29T10:00:00.000Z"),
      refreshToken: "old-refresh",
      refreshTokenExpiresAt: new Date("2026-10-27T09:00:00.000Z"),
      status: "INSTALLED",
    },
    {
      accessToken: "new-access",
      expires: new Date("2026-07-29T11:00:00.000Z"),
      refreshToken: "new-refresh",
      refreshTokenExpires: new Date("2026-10-27T10:00:00.000Z"),
    },
  );

  assert.deepEqual(update, {
    accessToken: "new-access",
    accessTokenExpiresAt: new Date("2026-07-29T11:00:00.000Z"),
    refreshToken: "new-refresh",
    refreshTokenExpiresAt: new Date("2026-10-27T10:00:00.000Z"),
    tokenRefreshLockId: null,
    tokenRefreshLockedAt: null,
  });
});

test("an older browser session cannot roll back a worker-refreshed token", () => {
  assert.deepEqual(
    buildStoreTokenUpdate(
      {
        accessToken: "worker-access",
        accessTokenExpiresAt: new Date("2026-07-29T12:00:00.000Z"),
        refreshToken: "worker-refresh",
        refreshTokenExpiresAt: new Date("2026-10-27T11:00:00.000Z"),
        status: "INSTALLED",
      },
      {
        accessToken: "older-browser-access",
        expires: new Date("2026-07-29T11:00:00.000Z"),
        refreshToken: "invalidated-browser-refresh",
        refreshTokenExpires: new Date("2026-10-27T10:00:00.000Z"),
      },
    ),
    {},
  );
});
