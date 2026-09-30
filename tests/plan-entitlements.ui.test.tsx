import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { SubscriptionPanel } from "../app/components/SubscriptionStatus";
import type { PlanEntitlements, SubscriptionView } from "../app/billing/types";

vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => ({}) }));
const availablePlans: PlanEntitlements[] = [
  {
    plan: "FREE",
    name: "Free",
    monthlyPriceCents: 0,
    includedPrimaryFeeds: 1,
    includedAdditionalFeeds: 1,
    productLimit: 10,
    additionalFeedPriceCents: 149,
  },
  {
    plan: "PRO",
    name: "Pro",
    monthlyPriceCents: 1000,
    includedPrimaryFeeds: 1,
    includedAdditionalFeeds: 5,
    productLimit: null,
    additionalFeedPriceCents: 149,
  },
];
function render(plan: "FREE" | "PRO" | null) {
  const client = new QueryClient();
  const subscription: SubscriptionView = {
    plan,
    entitlements: availablePlans.find((item) => item.plan === plan) ?? null,
    availablePlans,
    planHandle: plan ? "a-shopify-handle-not-a-display-name" : null,
    status: plan ? "ACTIVE" : "UNKNOWN",
    canUseApp: Boolean(plan),
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: false,
    currentBillingCycleEnd: null,
    currentBillingCycleStart: null,
    lastSyncedAt: new Date().toISOString(),
    lastSyncError: null,
    trialEndsAt: null,
  };
  const html = renderToString(
    <QueryClientProvider client={client}>
      <SubscriptionPanel
        shop="test.myshopify.com"
        initialSubscription={subscription}
        planSelectionUrl="https://admin.shopify.com/store/test/charges/app/pricing_plans"
      />
    </QueryClientProvider>,
  );
  client.clear();
  return html.replace(/<!--.*?-->/g, "");
}
for (const plan of ["FREE", "PRO"] as const) {
  it(`shows backend ${plan} entitlements and both hosted plan choices`, () => {
    const html = render(plan);
    expect(html).toContain(
      `<dt>Plan</dt><dd>${plan === "FREE" ? "Free" : "Pro"}</dd>`,
    );
    expect(html).toContain(
      `<dt>Products per feed</dt><dd>${plan === "FREE" ? "10" : "Unlimited"}</dd>`,
    );
    expect(html).toContain('id="plan-FREE-heading">Free</h3>');
    expect(html).toContain('id="plan-PRO-heading">Pro</h3>');
    expect(html).toContain("<span>$0</span><span>/month</span>");
    expect(html).toContain("<span>$10</span><span>/month</span>");
    expect(html).toContain(
      "Up to 10 products per feed, including their eligible variants",
    );
    expect(html).toContain("Unlimited products and variants");
    expect(html).toContain(
      "Additional feeds: <strong>$1.49/month each</strong>",
    );
    expect(html).toContain('target="_top"');
    expect(html.match(/Current plan/g)).toHaveLength(1);
    expect(html).not.toContain("a-shopify-handle-not-a-display-name");
  });
}
it("unknown billing does not display Free as the current plan", () => {
  const html = render(null);
  expect(html).toContain("<dt>Plan</dt><dd>Unavailable</dd>");
  expect(html).not.toContain("Current plan");
});
