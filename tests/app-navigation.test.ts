import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRouter } from "react-router";
import {
  appSections,
  dashboardTabFromLocation,
  dashboardTabHref,
  shouldRevalidateDashboard,
} from "../app/services/app-navigation.ts";

test("all six sidebar destinations have distinct paths matching their panels", () => {
  const paths = appSections.map(({ id }) => dashboardTabHref(id));
  assert.equal(new Set(paths).size, 6);
  for (const { id } of appSections) {
    const url = new URL(dashboardTabHref(id), "https://app.example");
    assert.equal(url.search, "");
    assert.equal(dashboardTabFromLocation(url), id);
  }
});

test("section paths override stale query tabs, and old bookmarks still resolve", () => {
  assert.equal(
    dashboardTabFromLocation(
      new URL("https://app.example/app/feeds?tab=configurations"),
    ),
    "feeds",
  );
  assert.equal(
    dashboardTabFromLocation(
      new URL("https://app.example/app?tab=diagnostics"),
    ),
    "diagnostics",
  );
  assert.equal(
    dashboardTabFromLocation(new URL("https://app.example/app/dashboard/")),
    "dashboard",
  );
  for (const path of [
    "/app",
    "/app/unknown",
    "/app/feed-data",
    "/app/feeds/unknown",
  ]) {
    assert.equal(
      dashboardTabFromLocation(new URL(path, "https://app.example")),
      null,
    );
  }
});

test("switching sections preserves embedded context and removes legacy tab state", () => {
  assert.equal(
    dashboardTabHref(
      "feeds",
      "?shop=test.myshopify.com&host=encoded&embedded=1&tab=configurations",
      "#details",
    ),
    "/app/feeds?shop=test.myshopify.com&host=encoded&embedded=1#details",
  );
});

test("router navigation follows every section and browser history without reloading shared data", async () => {
  let loads = 0;
  const router = createMemoryRouter(
    [
      {
        id: "sections",
        path: "/app/:section?",
        loader: () => ({ load: ++loads }),
        shouldRevalidate: shouldRevalidateDashboard,
      },
    ],
    { initialEntries: ["/app/configurations"] },
  );
  const waitForIdle = () =>
    new Promise<void>((resolve) => {
      if (
        router.state.initialized &&
        router.state.navigation.state === "idle"
      ) {
        resolve();
        return;
      }
      const unsubscribe = router.subscribe((state) => {
        if (state.initialized && state.navigation.state === "idle") {
          unsubscribe();
          resolve();
        }
      });
    });
  try {
    await waitForIdle();
    for (const { id } of appSections) {
      await router.navigate(dashboardTabHref(id));
      assert.equal(router.state.matches.at(-1)?.params.section, id);
      assert.equal(dashboardTabFromLocation(router.state.location), id);
    }
    assert.equal(loads, 1);
    await router.navigate(-1);
    await waitForIdle();
    assert.equal(dashboardTabFromLocation(router.state.location), "support");
    await router.navigate(1);
    await waitForIdle();
    assert.equal(dashboardTabFromLocation(router.state.location), "plan");
    await router.revalidate();
    await waitForIdle();
    assert.equal(loads, 2);
  } finally {
    router.dispose();
  }
});

test("mutations, billing returns, and session changes still revalidate", () => {
  const args = {
    currentUrl: new URL("https://app.example/app/configurations?shop=one"),
    nextUrl: new URL("https://app.example/app/feeds?shop=one"),
    currentParams: { section: "configurations" },
    nextParams: { section: "feeds" },
    defaultShouldRevalidate: true,
  };
  assert.equal(shouldRevalidateDashboard(args), false);
  assert.equal(
    shouldRevalidateDashboard({ ...args, formMethod: "POST" }),
    true,
  );
  assert.equal(
    shouldRevalidateDashboard({
      ...args,
      nextUrl: new URL("https://app.example/app/plan?shop=one&plan_handle=pro"),
    }),
    true,
  );
  assert.equal(
    shouldRevalidateDashboard({
      ...args,
      nextUrl: new URL("https://app.example/app/feeds?shop=two"),
    }),
    true,
  );
  assert.equal(
    shouldRevalidateDashboard({ ...args, nextUrl: args.currentUrl }),
    true,
  );
});
