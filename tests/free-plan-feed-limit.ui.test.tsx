import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FreePlanFeedLimitBanner } from "../app/components/FreePlanFeedLimitBanner";
import type { SubscriptionView } from "../app/billing/types";
import { feedKeys, type FeedQueryScope } from "../app/services/feed-query";

const scope: FeedQueryScope = {
  shop: "free.myshopify.com",
  sessionId: "session",
  locale: "en",
};
const free: SubscriptionView = {
  plan: "FREE",
  planHandle: "free-plan",
  status: "ACTIVE",
  canUseApp: true,
  entitlements: {
    plan: "FREE",
    name: "Free",
    monthlyPriceCents: 0,
    includedPrimaryFeeds: 1,
    includedAdditionalFeeds: 1,
    productLimit: 10,
    additionalFeedPriceCents: 149,
  },
  availablePlans: [],
  billingPeriod: "EVERY_30_DAYS",
  cancelAtEndOfCycle: false,
  currentBillingCycleStart: null,
  currentBillingCycleEnd: null,
  trialEndsAt: null,
  lastSyncedAt: null,
  lastSyncError: null,
};
let client: QueryClient;
beforeEach(() => {
  window.localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Banner must not fetch");
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

function primary(
  status = "PROCESSING",
  count: number | null = 200,
  target = scope,
) {
  client.setQueryData(feedKeys.primary(target, "/app/feed-data"), {
    ok: true,
    activeGeneration: null,
    feed: { id: "primary", status, totalProducts: count },
  });
}
function additional(count: number | null = 200, target = scope) {
  client.setQueryData(feedKeys.additional(target, "/app/additional-feeds"), {
    ok: true,
    activeGeneration: null,
    feeds: [1, 2].map((id) => ({
      feed: { id: String(id), status: "PROCESSING", totalProducts: count },
    })),
  });
}
function setup({
  subscription = free as SubscriptionView | null,
  count = 200,
  statistics = Promise.resolve({ totalProducts: count }),
} = {}) {
  const tree = (active = true, target = scope, plan = subscription) => (
    <QueryClientProvider client={client}>
      <FreePlanFeedLimitBanner
        active={active}
        scope={target}
        statistics={statistics}
        subscription={plan}
      />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    ...view,
    tree,
    banner: () => view.container.querySelector("s-banner"),
  };
}

it("shows one notice once generation starts, regardless of how many feeds generate", async () => {
  primary("NOT_GENERATED");
  const view = setup();
  await act(async () => {});
  expect(view.banner()).toBeNull();
  act(() => primary());
  await waitFor(() =>
    expect(view.banner()?.getAttribute("heading")).toContain(
      "up to 10 products",
    ),
  );
  act(() => additional());
  await waitFor(() =>
    expect(view.container.querySelectorAll("s-banner")).toHaveLength(1),
  );
  expect(view.banner()?.hasAttribute("dismissible")).toBe(true);
  expect(view.banner()?.textContent).toContain(
    "eligible products and their eligible variants",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("also triggers for an Additional feed without a Primary generation", async () => {
  primary("COMPLETED");
  additional();
  const view = setup();
  await waitFor(() => expect(view.banner()).not.toBeNull());
});

it("dismissal stays shared across pages, more generations, and a reload", async () => {
  primary();
  const view = setup();
  await waitFor(() => expect(view.banner()).not.toBeNull());
  fireEvent(view.banner()!, new Event("dismiss"));
  expect(view.banner()).toBeNull();
  view.rerender(view.tree(false));
  act(() => {
    primary("COMPLETED");
    additional();
  });
  view.rerender(view.tree(true));
  await act(async () => {});
  expect(view.banner()).toBeNull();
  view.unmount();
  const reloaded = setup();
  await act(async () => {});
  expect(reloaded.banner()).toBeNull();
});

it("remains visible after completion until dismissed, and only on the two requested pages", async () => {
  primary();
  const view = setup();
  await waitFor(() => expect(view.banner()).not.toBeNull());
  act(() => primary("COMPLETED"));
  view.rerender(view.tree(false));
  expect(view.banner()).toBeNull();
  view.rerender(view.tree(true));
  expect(view.banner()).not.toBeNull();
  view.unmount();
  const reloaded = setup();
  await waitFor(() => expect(reloaded.banner()).not.toBeNull());
});

for (const count of [0, 10]) {
  it(`does not show the notice for a store with ${count} products`, async () => {
    primary("PROCESSING", count);
    const view = setup({ count });
    await act(async () => {});
    expect(view.banner()).toBeNull();
  });
}

it("does not show for Pro or unverified subscriptions and hides on upgrade", async () => {
  primary();
  const view = setup({ subscription: null });
  await act(async () => {});
  expect(view.banner()).toBeNull();
  view.rerender(view.tree(true, scope, free));
  await waitFor(() => expect(view.banner()).not.toBeNull());
  view.rerender(
    view.tree(true, scope, {
      ...free,
      plan: "PRO",
      entitlements: { ...free.entitlements!, plan: "PRO", productLimit: null },
    }),
  );
  expect(view.banner()).toBeNull();
});

it("waits for the catalog count even if generation completes before statistics resolve", async () => {
  let resolve!: (value: { totalProducts: number }) => void;
  const statistics = new Promise<{ totalProducts: number }>((done) => {
    resolve = done;
  });
  primary("QUEUED", null);
  const view = setup({ statistics });
  await act(async () => {});
  expect(view.banner()).toBeNull();
  await act(async () => {
    primary("COMPLETED", null);
    resolve({ totalProducts: 200 });
  });
  await waitFor(() => expect(view.banner()).not.toBeNull());
});

it("can use generation totals when dashboard statistics are unavailable", async () => {
  primary();
  const view = setup({
    statistics: Promise.reject(new Error("Statistics unavailable")),
  });
  await waitFor(() => expect(view.banner()).not.toBeNull());
});

it("keeps dismissal isolated to the store", async () => {
  primary();
  const view = setup();
  await waitFor(() => expect(view.banner()).not.toBeNull());
  fireEvent(view.banner()!, new Event("dismiss"));
  const otherScope = { ...scope, shop: "other.myshopify.com" };
  act(() => primary("PROCESSING", 200, otherScope));
  view.rerender(view.tree(true, otherScope));
  await waitFor(() => expect(view.banner()).not.toBeNull());
  view.rerender(view.tree(true));
  await act(async () => {});
  expect(view.banner()).toBeNull();
});

it("still dismisses when embedded browser storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  primary();
  const view = setup();
  await waitFor(() => expect(view.banner()).not.toBeNull());
  fireEvent(view.banner()!, new Event("dismiss"));
  act(() => additional());
  await act(async () => {});
  expect(view.banner()).toBeNull();
});
