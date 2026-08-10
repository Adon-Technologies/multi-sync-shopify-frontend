import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tabsSource = readFileSync(
  new URL("../app/components/DashboardTabs.tsx", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("../app/components/SupportPanel.tsx", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../app/routes/app.support-data.tsx", import.meta.url),
  "utf8",
);
const querySource = readFileSync(
  new URL("../app/services/support-query.ts", import.meta.url),
  "utf8",
);

test("merchant navigation exposes a Shopify Polaris Support tab", () => {
  assert.match(tabsSource, /id: "support", label: "Support"/);
  assert.match(tabsSource, /MdOutlineSupportAgent/);
  assert.match(panelSource, /PolarisAppProvider/);
  assert.match(panelSource, /EmptyState/);
  assert.match(panelSource, /IndexTable/);
  assert.match(panelSource, /Modal/);
});

test("ticket creation validates only the title and opens its conversation", () => {
  assert.match(panelSource, /const canCreate = newTitle\.trim\(\)\.length >= 3/);
  assert.match(panelSource, /createSupportTicket\(newTitle\)/);
  assert.match(panelSource, /setSelectedTicketId\(ticket\.id\)/);
  assert.doesNotMatch(querySource, /intent: "create"; message:/);
});

test("merchant requests derive store identity from the authenticated session", () => {
  assert.match(routeSource, /authenticateActiveAdmin\(request\)/);
  assert.match(routeSource, /requestFeedBackend/);
  assert.doesNotMatch(routeSource, /body\.storeId|searchParams\.get\("storeId"\)/);
});

test("active conversations poll lightly and closed tickets block composing", () => {
  assert.match(panelSource, /ticket\.status !== "CLOSED" \? 7_000 : false/);
  assert.match(panelSource, /This conversation has been closed\./);
  assert.match(panelSource, /End this support conversation\?/);
  assert.match(panelSource, /disabled={!canReply}/);
});
