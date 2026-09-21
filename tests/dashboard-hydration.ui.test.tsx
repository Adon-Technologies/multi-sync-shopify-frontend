import { type ReactNode } from "react";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { DashboardTabs } from "../app/components/DashboardTabs";
import { DiagnosticsPanel } from "../app/components/DiagnosticsPanel";
import type { SubscriptionView } from "../app/billing/types";
import {
  configurationQueryOptions,
  type ConfigurationResponse,
} from "../app/services/configuration-query";

vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => ({}) }));
vi.mock("../app/components/FeedsPanel", () => ({ FeedsPanel: () => null }));
vi.mock("../app/components/ConfigurationsPanel", () => ({
  ConfigurationsPanel: () => null,
}));
vi.mock("../app/components/SupportPanel", () => ({ SupportPanel: () => null }));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useLocation: () => ({ pathname: "/app/dashboard", search: "", hash: "" }),
  useNavigate: () => vi.fn(),
}));

let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  client?.clear();
  container?.remove();
});

function setup() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  return function wrap(children: ReactNode) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

it("hydrates diagnostics without custom event attributes and handles nested popover hide", async () => {
  const wrap = setup();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const recoverable = vi.fn();
  const tree = wrap(<DiagnosticsPanel active={false} scope={null} />);
  container.innerHTML = renderToString(tree);
  expect(container.innerHTML).not.toMatch(/onhide=|onshow=/i);
  await act(async () => {
    root = hydrateRoot(container, tree, { onRecoverableError: recoverable });
  });
  expect(errors.mock.calls).toEqual([]);
  expect(recoverable).not.toHaveBeenCalled();

  const popover = container.querySelector('s-popover[id*="product-type"]')!;
  const search = popover.querySelector("s-search-field")!;
  const modal = popover.closest("s-modal")!;
  const parentHide = vi.fn();
  modal.addEventListener("hide", parentHide);
  Object.defineProperty(search, "value", {
    configurable: true,
    writable: true,
    value: "Shoes",
  });
  await act(async () => {
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(search.getAttribute("value")).toBe("Shoes");
  await act(async () => {
    popover.dispatchEvent(new Event("hide", { bubbles: true }));
  });
  expect(search.getAttribute("value")).toBe("");
  expect(parentHide).not.toHaveBeenCalled();
  await act(async () => {
    popover.dispatchEvent(new Event("show"));
  });
  expect(search.getAttribute("value")).toBe("Shoes");
  // After unmount the old element must no longer stop events or update state.
  await act(async () => root?.unmount());
  root = undefined;
  popover.dispatchEvent(new Event("hide", { bubbles: true }));
  expect(parentHide).toHaveBeenCalledOnce();
});

function tracked<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    _tracked: true,
    _data: value,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function configurationResponse(alertsEmail: string): ConfigurationResponse {
  return {
    ok: true,
    intent: "configuration",
    feedRefreshRequired: false,
    ruleJobs: { age: null, gender: null },
    configuration: {
      id: "test-configuration",
      updatedAt: "2026-09-18T12:00:00Z",
      alertsEmail,
      countryCode: "US",
      colorOptions: [],
      sizeOptions: [],
      excludedCollections: [],
      excludedTitleTerms: [],
      excludedProductTags: [],
      productTypes: [],
      ageRules: [],
      ageRulesAppliedVersion: 0,
      ageRulesVersion: 0,
      defaultAgeGroup: null,
      genderRules: [],
      genderRulesAppliedVersion: 0,
      genderRulesVersion: 0,
      defaultGender: null,
      showSalePriceInGoogleFeed: true,
      useProductImageAsMainImage: false,
      includeShippingWeightInGoogleFeed: false,
      excludeOutOfStockItems: false,
      ignoreShopifyInventoryInGoogleFeed: false,
      inventorySourceMode: "ALL_LOCATIONS",
      selectedInventoryLocationIds: [],
      disableUtmParameters: false,
      disablePrimaryCurrencyParameter: false,
      checkoutLinkMode: "DISABLED",
    },
  };
}

it.each([false, true])(
  "keeps server-rendered dashboard sections during startup updates (store queries enabled: %s)",
  async (withStore) => {
    const wrap = setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );
    let measure: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      measure = callback;
      return 1;
    });
    const recoverable = vi.fn();
    const statistics = {
      generatedAt: "2026-09-18T12:00:00Z",
      totalProducts: 42,
      publishedProducts: 40,
      publishedProductVariants: 45,
      unpublishedProducts: 2,
    };
    const store = { currency: "USD", domain: "hydration-test.myshopify.com" };
    const scope = { shop: store.domain, sessionId: "test-session" };
    const subscription: SubscriptionView = {
      canUseApp: true,
      status: "ACTIVE",
      billingPeriod: "Monthly",
      cancelAtEndOfCycle: false,
      currentBillingCycleEnd: null,
      currentBillingCycleStart: null,
      lastSyncedAt: null,
      lastSyncError: null,
      planHandle: "pro-plan",
      trialEndsAt: null,
    };
    const props = {
      diagnosticsScope: withStore ? scope : null,
      feedScope: withStore ? { ...scope, locale: null } : null,
      initialSubscription: withStore ? subscription : null,
      isRefreshing: false,
      onRefresh: vi.fn(),
      planSelectionUrl: null,
    };
    container.innerHTML = renderToString(
      wrap(
        <DashboardTabs
          {...props}
          statistics={tracked(statistics)}
          storeInformation={tracked(store)}
        />,
      ),
    );
    const originalDomain = Array.from(container.querySelectorAll("dd")).find(
      (element) => element.textContent === store.domain,
    );
    expect(originalDomain).toBeTruthy();
    const pendingStatistics = deferred<typeof statistics>();
    const pendingStore = deferred<typeof store>();
    await act(async () => {
      root = hydrateRoot(
        container,
        wrap(
          <DashboardTabs
            {...props}
            statistics={pendingStatistics.promise}
            storeInformation={pendingStore.promise}
          />,
        ),
        { onRecoverableError: recoverable },
      );
    });
    await act(async () => {
      measure?.(0);
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.contains(originalDomain!)).toBe(true);
    if (withStore) {
      await act(async () => {
        client.setQueryData(
          configurationQueryOptions(scope).queryKey,
          configurationResponse("alerts@example.com"),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(recoverable).not.toHaveBeenCalled();
      expect(container.contains(originalDomain!)).toBe(true);
    }
    await act(async () => {
      pendingStatistics.resolve(statistics);
    });
    // The two loader streams resolve independently; the store still hydrates.
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.contains(originalDomain!)).toBe(true);
    await act(async () => {
      pendingStore.resolve(store);
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.contains(originalDomain!)).toBe(true);
    if (withStore) {
      expect(container.textContent).toContain("alerts@example.com");
      await act(async () => {
        client.setQueryData(
          configurationQueryOptions(scope).queryKey,
          configurationResponse("updated@example.com"),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(container.textContent).toContain("updated@example.com");
      expect(recoverable).not.toHaveBeenCalled();
    }
  },
);
