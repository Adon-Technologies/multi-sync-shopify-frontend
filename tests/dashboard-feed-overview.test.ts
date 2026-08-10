import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../app/components/DashboardTabs.tsx", import.meta.url),
  "utf8",
);

test("Dashboard loads the authenticated store's Primary and Additional feeds", () => {
  assert.match(dashboardSource, /primaryFeedQueryOptions\(safeFeedScope\)/);
  assert.match(dashboardSource, /additionalFeedsQueryOptions\(safeFeedScope\)/);
  assert.match(dashboardSource, /enabled:[\s\S]*Boolean\(feedScope\)/);
});

test("Dashboard shows feed count and each Market detail requested", () => {
  assert.match(dashboardSource, /rows\.length === 1 \? "feed" : "feeds"/);
  for (const heading of ["Market", "Country", "Language", "Currency", "Status"]) {
    assert.match(dashboardSource, new RegExp(`>${heading}<\\/s-table-header>`));
  }
  assert.match(dashboardSource, /primaryData\.market\?\.languageName/);
  assert.match(dashboardSource, /additionalData\?\.feeds\.map/);
});

test("Dashboard refresh also refreshes feed inventory without recreating QueryClient", () => {
  assert.match(dashboardSource, /void primaryFeedQuery\.refetch\(\)/);
  assert.match(dashboardSource, /void additionalFeedsQuery\.refetch\(\)/);
  assert.doesNotMatch(dashboardSource, /new QueryClient/);
});
