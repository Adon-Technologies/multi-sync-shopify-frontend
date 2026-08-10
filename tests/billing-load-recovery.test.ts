import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../app/routes/app._index.tsx", import.meta.url),
  "utf8",
);

test("billing verification failures render a retryable app state", () => {
  assert.match(
    routeSource,
    /try \{[\s\S]*getSubscriptionForSession[\s\S]*catch \(error\) \{[\s\S]*subscriptionError = billingErrorMessage\(error\)/,
  );
  assert.match(routeSource, /if \(subscriptionError\) \{/);
  assert.match(
    routeSource,
    /heading="Subscription verification is temporarily unavailable"/,
  );
  assert.match(routeSource, /useRevalidator\(\)/);
  assert.match(routeSource, /onClick=\{\(\) => revalidator\.revalidate\(\)\}/);
  assert.match(routeSource, /Your existing subscription has not been changed/);
});

test("billing failure does not start paid dashboard data requests", () => {
  assert.match(routeSource, /storeInformation: subscription\?\.canUseApp/);
  assert.match(routeSource, /statistics: subscription\?\.canUseApp/);
  assert.match(
    routeSource,
    /getPlanSelectionForSession\(session\)\.catch\([\s\S]*\(\) => null/,
  );
});
