import assert from "node:assert/strict";
import test from "node:test";

import {
  expandCandidateFile,
  validateCandidate,
} from "./insert-approved-store.mjs";

function candidate(overrides = {}) {
  return {
    formatVersion: 1,
    sourceShopDomain: "example.myshopify.com",
    targetDatabase: "Multi-sync",
    document: {
      shopDomain: "example.myshopify.com",
      accessToken: null,
      status: "INSTALLED",
      accessStatus: "ACTIVE",
      installedAt: "2026-01-01T00:00:00.000Z",
      uninstalledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

test("accepts editable Store status, access status, and dates", () => {
  const document = validateCandidate(
    candidate({
      status: "UNINSTALLED",
      accessStatus: "SUSPENDED",
      uninstalledAt: "2026-02-01T00:00:00.000Z",
    }),
    "Multi-sync",
  );

  assert.equal(document.status, "UNINSTALLED");
  assert.equal(document.accessStatus, "SUSPENDED");
  assert.equal(
    document.uninstalledAt.toISOString(),
    "2026-02-01T00:00:00.000Z",
  );
  assert.deepEqual(Object.keys(document), [
    "shopDomain",
    "shopPlan",
    "accessStatus",
    "accessToken",
    "status",
    "installedAt",
    "createdAt",
    "updatedAt",
    "uninstalledAt",
    "feedGenerationFeedId",
    "feedGenerationLockedAt",
    "accessTokenExpiresAt",
    "refreshToken",
    "refreshTokenExpiresAt",
    "tokenRefreshLockId",
    "tokenRefreshLockedAt",
  ]);
});

test("refuses unknown fields in an approved Store", () => {
  assert.throws(
    () => validateCandidate(candidate({ countryCode: "US" }), "Multi-sync"),
    /Unsupported Store fields: countryCode/,
  );
});

test("refuses access tokens in editable files", () => {
  assert.throws(
    () =>
      validateCandidate(
        candidate({ accessToken: "must-not-be-here" }),
        "Multi-sync",
      ),
    /cannot contain access tokens/,
  );
});

test("refuses a changed shop identity", () => {
  assert.throws(
    () =>
      validateCandidate(
        candidate({ shopDomain: "another.myshopify.com" }),
        "Multi-sync",
      ),
    /cannot differ from sourceShopDomain/,
  );
});

test("expands an editable bulk candidate without token values", () => {
  const first = candidate();
  const second = candidate({
    shopDomain: "second.myshopify.com",
  });
  const entries = expandCandidateFile(
    {
      formatVersion: 1,
      candidateType: "StoreBulk",
      targetDatabase: "Multi-sync",
      stores: [
        {
          sourceShopDomain: first.sourceShopDomain,
          accessTokenAvailable: true,
          document: first.document,
        },
        {
          sourceShopDomain: "second.myshopify.com",
          accessTokenAvailable: false,
          document: second.document,
        },
      ],
    },
    "Multi-sync",
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[0].accessTokenAvailable, true);
  assert.equal(entries[0].document.accessToken, null);
  assert.equal(entries[1].document.shopDomain, "second.myshopify.com");
});
