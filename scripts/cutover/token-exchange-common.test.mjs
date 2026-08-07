import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalHash,
  normalizeShop,
  parseTokenExchangeResponse,
} from "./token-exchange-common.mjs";

test("candidate approval hashes exclude only the approvalHash field", () => {
  const candidate = {
    candidateType: "ShopifyOfflineTokenExchange",
    eligible: [{ shopDomain: "example.myshopify.com" }],
  };
  const hash = approvalHash(candidate);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(
    approvalHash({ ...candidate, approvalHash: hash }),
    hash,
  );
  assert.notEqual(
    approvalHash({
      ...candidate,
      eligible: [{ shopDomain: "changed.myshopify.com" }],
    }),
    hash,
  );
});

test("token exchange responses produce both absolute expirations", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const result = parseTokenExchangeResponse(
    {
      access_token: "new-access",
      expires_in: 3600,
      refresh_token: "new-refresh",
      refresh_token_expires_in: 7_776_000,
    },
    now,
  );
  assert.equal(
    result.accessTokenExpiresAt.toISOString(),
    "2026-08-07T13:00:00.000Z",
  );
  assert.equal(
    result.refreshTokenExpiresAt.toISOString(),
    "2026-11-05T12:00:00.000Z",
  );
});

test("incomplete exchange responses are rejected", () => {
  assert.throws(
    () =>
      parseTokenExchangeResponse({
        access_token: "new-access",
        expires_in: 3600,
      }),
    /incomplete expiring offline-token response/,
  );
});

test("shop domains are normalized and validated", () => {
  assert.equal(
    normalizeShop(" Example-Shop.MyShopify.com "),
    "example-shop.myshopify.com",
  );
  assert.equal(normalizeShop("https://example.myshopify.com"), null);
});
