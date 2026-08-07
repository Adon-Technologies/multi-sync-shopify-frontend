import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeShopDomain,
  transformLegacyStore,
} from "./store-transform.mjs";
import { parseArguments, validateEnvironment } from "./01-stores.mjs";

test("normalizes Shopify domains", () => {
  assert.equal(
    normalizeShopDomain(" Example-Shop.myshopify.com "),
    "example-shop.myshopify.com",
  );
});

test("transforms an installed active store without copying its token", () => {
  const firstInstallAt = new Date("2025-01-01T00:00:00.000Z");
  const lastInstallAt = new Date("2026-01-01T00:00:00.000Z");
  const { document, warnings } = transformLegacyStore({
    includeAccessTokens: false,
    installerShop: {
      installed: true,
      firstInstallAt,
      lastInstallAt,
    },
    migrationTime: new Date("2026-08-07T00:00:00.000Z"),
    shopAccess: { suspended: false },
    store: {
      shopDomain: "Example.myshopify.com",
      accessToken: "secret-token",
      countryCode: "US",
    },
  });

  assert.equal(document.shopDomain, "example.myshopify.com");
  assert.equal(document.status, "INSTALLED");
  assert.equal(document.accessStatus, "ACTIVE");
  assert.equal(document.accessToken, null);
  assert.equal(document.installedAt, lastInstallAt);
  assert.equal(document.createdAt, firstInstallAt);
  assert.deepEqual(warnings, []);
  assert.equal("countryCode" in document, false);
});

test("copies a token only when explicitly requested for an installed store", () => {
  const { document } = transformLegacyStore({
    includeAccessTokens: true,
    installerShop: { installed: true },
    migrationTime: new Date("2026-08-07T00:00:00.000Z"),
    shopAccess: { suspended: false },
    store: {
      shopDomain: "example.myshopify.com",
      accessToken: " secret-token ",
    },
  });

  assert.equal(document.accessToken, "secret-token");
  assert.equal(document.refreshToken, null);
});

test("clears tokens and records lifecycle for an uninstalled store", () => {
  const uninstalledAt = new Date("2026-07-01T00:00:00.000Z");
  const { document } = transformLegacyStore({
    includeAccessTokens: true,
    installerShop: {
      installed: false,
      firstInstallAt: new Date("2025-01-01T00:00:00.000Z"),
      lastUninstallAt: uninstalledAt,
    },
    migrationTime: new Date("2026-08-07T00:00:00.000Z"),
    shopAccess: { suspended: true },
    store: {
      shopDomain: "example.myshopify.com",
      accessToken: "must-not-be-copied",
    },
  });

  assert.equal(document.status, "UNINSTALLED");
  assert.equal(document.accessStatus, "SUSPENDED");
  assert.equal(document.accessToken, null);
  assert.equal(document.uninstalledAt, uninstalledAt);
});

test("forces a store without an access token to UNINSTALLED", () => {
  const migrationTime = new Date("2026-08-07T00:00:00.000Z");
  const { document, warnings } = transformLegacyStore({
    includeAccessTokens: true,
    installerShop: {
      installed: true,
      firstInstallAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    migrationTime,
    shopAccess: { suspended: false },
    store: {
      shopDomain: "missing-token.myshopify.com",
      accessToken: null,
    },
  });

  assert.equal(document.status, "UNINSTALLED");
  assert.equal(document.accessToken, null);
  assert.equal(document.uninstalledAt, migrationTime);
  assert.match(warnings.join(" "), /forced status to UNINSTALLED/);
});

test("rejects an invalid source shop domain", () => {
  assert.throws(
    () =>
      transformLegacyStore({
        store: { shopDomain: "not-a-shop-domain" },
      }),
    /valid myshopify\.com domain/,
  );
});

test("defaults migration arguments to dry-run without token copying", () => {
  assert.deepEqual(parseArguments([]), {
    confirmTarget: null,
    execute: false,
    help: false,
    includeAccessTokens: false,
    limit: null,
    output: null,
    prepare: null,
    prepareAll: null,
    shop: null,
  });
});

test("requires an exact target confirmation before execution", () => {
  const options = parseArguments(["--execute"]);
  const environment = {
    SOURCE_DATABASE_NAME: "gsf",
    SOURCE_MONGODB_URI: "mongodb://source.example/",
    TARGET_DATABASE_NAME: "Multi-sync",
    TARGET_MONGODB_URI: "mongodb://target.example/",
  };

  assert.throws(
    () => validateEnvironment(options, environment),
    /--confirm-target=Multi-sync/,
  );
});

test("refuses to use any source database other than gsf", () => {
  const options = parseArguments(["--dry-run"]);
  const environment = {
    SOURCE_DATABASE_NAME: "Multi-sync",
    SOURCE_MONGODB_URI: "mongodb://source.example/",
    TARGET_DATABASE_NAME: "test-target",
    TARGET_MONGODB_URI: "mongodb://target.example/",
  };

  assert.throws(
    () => validateEnvironment(options, environment),
    /must be exactly "gsf"/,
  );
});

test("uses DATABASE_URL with the safe default database names", () => {
  const options = parseArguments(["--dry-run"]);
  const environment = validateEnvironment(options, {
    DATABASE_URL: "mongodb://shared.example/",
  });

  assert.deepEqual(environment, {
    sourceDatabaseName: "gsf",
    sourceUri: "mongodb://shared.example/",
    targetDatabaseName: "Multi-sync",
    targetUri: "mongodb://shared.example/",
  });
});
