import assert from "node:assert/strict";
import test from "node:test";

import { validateCandidate } from "./apply-shopify-csv-stores.mjs";

function insertEntry() {
  return {
    action: "insert",
    sourceShopDomain: "example.myshopify.com",
    shopifyPlan: "Basic",
    accessTokenAvailable: false,
    warnings: [],
    targetId: null,
    before: null,
    changes: null,
    document: {
      shopDomain: "example.myshopify.com",
      shopPlan: "Basic",
      accessStatus: "ACTIVE",
      accessToken: null,
      status: "INSTALLED",
      installedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
      uninstalledAt: null,
      feedGenerationFeedId: null,
      feedGenerationLockedAt: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenRefreshLockId: null,
      tokenRefreshLockedAt: null,
    },
  };
}

function candidate(stores = [insertEntry()]) {
  return {
    formatVersion: 1,
    candidateType: "StoreCsvReconciliation",
    targetDatabase: "Multi-sync",
    policy: { deletesAllowed: false },
    stores,
  };
}

test("validates a token-free installed CSV insert", () => {
  const operations = validateCandidate(candidate(), "Multi-sync");
  assert.equal(operations.length, 1);
  assert.equal(operations[0].document.status, "INSTALLED");
  assert.equal(operations[0].document.shopPlan, "Basic");
  assert.equal(operations[0].document.accessToken, null);
});

test("rejects token values and uninstalled CSV inserts", () => {
  const withToken = insertEntry();
  withToken.document.accessToken = "secret";
  assert.throws(
    () => validateCandidate(candidate([withToken]), "Multi-sync"),
    /cannot contain a token/,
  );

  const uninstalled = insertEntry();
  uninstalled.document.status = "UNINSTALLED";
  assert.throws(
    () => validateCandidate(candidate([uninstalled]), "Multi-sync"),
    /must be INSTALLED/,
  );
});

test("validates an existing Store reactivation without token mutation", () => {
  const operations = validateCandidate(
    candidate([
      {
        action: "reactivate",
        sourceShopDomain: "example.myshopify.com",
        shopifyPlan: "Grow",
        accessTokenAvailable: false,
        warnings: [],
        targetId: "66aa11111111111111111111",
        before: {
          shopDomain: "example.myshopify.com",
          shopPlan: null,
          status: "UNINSTALLED",
          uninstalledAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
        changes: {
          shopPlan: "Grow",
          status: "INSTALLED",
          uninstalledAt: null,
          updatedAt: "2026-08-07T00:00:00.000Z",
        },
        document: null,
      },
    ]),
    "Multi-sync",
  );

  assert.equal(operations[0].action, "reactivate");
  assert.deepEqual(Object.keys(operations[0].changes), [
    "shopPlan",
    "status",
    "uninstalledAt",
    "updatedAt",
  ]);
});

test("rejects candidates that allow deletes", () => {
  const invalid = candidate();
  invalid.policy.deletesAllowed = true;
  assert.throws(
    () => validateCandidate(invalid, "Multi-sync"),
    /prohibit deletes/,
  );
});
