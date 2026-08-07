import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubscriptionEntry,
  isLivePayingSubscriber,
} from "./prepare-subscriptions.mjs";

const generatedAt = new Date("2026-08-07T12:00:00.000Z");

test("live real subscriptions outside trial are paying subscribers", () => {
  assert.equal(
    isLivePayingSubscriber(
      {
        createdAt: "2026-06-01T00:00:00Z",
        status: "ACTIVE",
        test: false,
        trialDays: 7,
      },
      generatedAt,
    ),
    true,
  );
  assert.equal(
    isLivePayingSubscriber(
      {
        createdAt: "2026-08-06T00:00:00Z",
        status: "ACTIVE",
        test: false,
        trialDays: 7,
      },
      generatedAt,
    ),
    false,
  );
  assert.equal(
    isLivePayingSubscriber(
      {
        createdAt: "2026-06-01T00:00:00Z",
        status: "ACTIVE",
        test: true,
        trialDays: 0,
      },
      generatedAt,
    ),
    false,
  );
});

test("candidate uses Admin creation time and Partner billing cycle", () => {
  const entry = buildSubscriptionEntry({
    adminSubscription: {
      createdAt: "2026-06-01T08:00:00Z",
      currentPeriodEnd: "2026-08-30T08:00:00Z",
      id: "gid://shopify/AppSubscription/123",
      name: "Pro Plan",
      status: "ACTIVE",
      test: false,
      trialDays: 7,
    },
    generatedAt,
    partnerSubscription: {
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      currentBillingCycle: {
        endTime: "2026-08-30T08:00:00Z",
        startTime: "2026-07-31T08:00:00Z",
      },
      items: [
        {
          handle: "pro-plan",
          price: { __typename: "FlatRatePrice", active: true },
        },
      ],
      legacySubscriptionId: "gid://shopify/AppSubscription/123",
      pendingUpdate: null,
      shop: {
        id: "gid://shopify/Shop/456",
        myshopifyDomain: "example.myshopify.com",
      },
      trialEndsAt: null,
    },
    shopDomain: "example.myshopify.com",
    shopifyShopId: "gid://shopify/Shop/456",
    storeId: "6a758b00694d376a5b3ddcaf",
  });

  assert.equal(entry.document.status, "ACTIVE");
  assert.equal(entry.document.planHandle, "pro-plan");
  assert.equal(entry.document.createdAt, "2026-06-01T08:00:00.000Z");
  assert.equal(
    entry.document.currentBillingCycleStart,
    "2026-07-31T08:00:00.000Z",
  );
  assert.equal(
    entry.document.currentBillingCycleEnd,
    "2026-08-30T08:00:00.000Z",
  );
  assert.equal(entry.document.updatedAt, generatedAt.toISOString());
  assert.equal(entry.document.lastSyncedAt, generatedAt.toISOString());
  assert.deepEqual(entry.warnings, []);
});

test("legacy Billing API candidate derives cycle start and records warnings", () => {
  const entry = buildSubscriptionEntry({
    adminSubscription: {
      createdAt: "2026-06-01T08:00:00Z",
      currentPeriodEnd: "2026-08-30T08:00:00Z",
      id: "gid://shopify/AppSubscription/123",
      lineItems: [
        {
          plan: {
            pricingDetails: {
              __typename: "AppRecurringPricing",
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
      name: "Pro Plan",
      status: "ACTIVE",
      test: false,
      trialDays: 7,
    },
    generatedAt,
    partnerSubscription: null,
    planHandle: "pro-plan",
    shopDomain: "example.myshopify.com",
    shopifyShopId: "gid://shopify/Shop/456",
    storeId: "6a758b00694d376a5b3ddcaf",
  });

  assert.equal(entry.document.billingPeriod, "EVERY_30_DAYS");
  assert.equal(entry.document.cancelAtEndOfCycle, false);
  assert.equal(entry.document.planHandle, "pro-plan");
  assert.equal(
    entry.document.currentBillingCycleStart,
    "2026-07-31T08:00:00.000Z",
  );
  assert.equal(
    entry.document.currentBillingCycleEnd,
    "2026-08-30T08:00:00.000Z",
  );
  assert.equal(entry.warnings.length, 4);
});
