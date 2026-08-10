import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cleanPlanSelectionReturnPath,
  remainingTrialMessage,
  remainingTrialTime,
} from "../app/billing/types.ts";

const now = new Date("2026-08-04T12:00:00.000Z");

test("trial display rounds up days only above 48 hours", () => {
  const remaining = remainingTrialTime("2026-08-07T00:01:00.000Z", now);
  assert.deepEqual(remaining, { kind: "days", value: 3 });
  assert.equal(
    remainingTrialMessage(remaining),
    "You have 3 days remaining in your free trial.",
  );
});

test("trial display uses hours and minutes near expiry", () => {
  assert.deepEqual(remainingTrialTime("2026-08-04T20:00:00.000Z", now), {
    kind: "hours",
    value: 8,
  });
  assert.deepEqual(remainingTrialTime("2026-08-04T12:37:00.000Z", now), {
    kind: "minutes",
    value: 37,
  });
});

test("expired trial never displays zero days", () => {
  const remaining = remainingTrialTime("2026-08-04T11:59:59.000Z", now);
  assert.deepEqual(remaining, { kind: "expired", value: 0 });
  assert.doesNotMatch(remainingTrialMessage(remaining), /0 days/);
});

test("plan return cleanup removes billing params without dropping embedded auth", () => {
  assert.equal(
    cleanPlanSelectionReturnPath(
      "https://example.test/app?shop=adon-test-1.myshopify.com&host=encoded-host&embedded=1&plan_handle=pro-plan&charge_id=62074945863",
    ),
    "/app?shop=adon-test-1.myshopify.com&host=encoded-host&embedded=1",
  );
});

test("Dashboard uses Shopify trialEndsAt and the return path forces a live sync", () => {
  const component = readFileSync(
    new URL("../app/components/SubscriptionStatus.tsx", import.meta.url),
    "utf8",
  );
  const auth = readFileSync(
    new URL("../app/shopify.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(component, /Your free trial is active/);
  assert.match(component, /query\.data\.trialEndsAt/);
  assert.match(auth, /searchParams\.has\("plan_handle"\)/);
  assert.match(auth, /force:\s*[\s\S]*returnedFromPlanSelection/);
  assert.match(auth, /cleanPlanSelectionReturnPath\(request\.url\)/);
  assert.doesNotMatch(auth, /context\.redirect\("\/app"\)/);
  assert.doesNotMatch(auth, /status\s*=\s*["']ACTIVE["']/);
});

test("Plan provides confirmed deferred cancellation and updates only subscription cache", () => {
  const panel = readFileSync(
    new URL("../app/components/SubscriptionStatus.tsx", import.meta.url),
    "utf8",
  );
  const modal = readFileSync(
    new URL("../app/components/CancelSubscriptionModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panel, /Cancel subscription/);
  assert.match(panel, /query\.data\.status === "ACTIVE"/);
  assert.match(panel, /!query\.data\.cancelAtEndOfCycle/);
  assert.match(panel, /setQueryData\(subscriptionKeys\.detail\(shop\)/);
  assert.match(panel, /Cancellation scheduled/);
  assert.match(modal, /Cancel subscription\?/);
  assert.match(modal, /remain active until/);
  assert.match(modal, /Keep subscription/);
  assert.match(modal, /isCanceling/);
});

test("inactive access remains navigable with one shared banner on all paid tabs", () => {
  const tabs = readFileSync(
    new URL("../app/components/DashboardTabs.tsx", import.meta.url),
    "utf8",
  );
  const status = readFileSync(
    new URL("../app/components/SubscriptionStatus.tsx", import.meta.url),
    "utf8",
  );
  const auth = readFileSync(
    new URL("../app/shopify.server.ts", import.meta.url),
    "utf8",
  );
  assert.ok((tabs.match(/BillingAccessGate/g) ?? []).length >= 4);
  assert.match(tabs, /InactivePlanBanner/);
  assert.match(status, /Your plan is inactive/);
  assert.match(status, /Choose a plan/);
  assert.match(tabs, /disabled={!initialSubscription\?\.canUseApp/);
  assert.match(auth, /SUBSCRIPTION_REQUIRED/);
  assert.doesNotMatch(auth, /redirect\(planSelection\.url/);
});
