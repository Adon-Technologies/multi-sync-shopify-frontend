import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shopifySource = readFileSync(
  new URL("../app/shopify.server.ts", import.meta.url),
  "utf8",
);
const configurationSource = readFileSync(
  new URL("../app/services/configuration.server.ts", import.meta.url),
  "utf8",
);
const backendClientSource = readFileSync(
  new URL("../app/services/feed-backend.server.ts", import.meta.url),
  "utf8",
);
const homeRouteSource = readFileSync(
  new URL("../app/routes/app._index.tsx", import.meta.url),
  "utf8",
);
const feedsPanelSource = readFileSync(
  new URL("../app/components/FeedsPanel.tsx", import.meta.url),
  "utf8",
);
const feedDataRouteSource = readFileSync(
  new URL("../app/routes/app.feed-data.tsx", import.meta.url),
  "utf8",
);
const uninstallWebhookSource = readFileSync(
  new URL("../app/routes/webhooks.app.uninstalled.tsx", import.meta.url),
  "utf8",
);
const storeServiceSource = readFileSync(
  new URL("../app/services/store.server.ts", import.meta.url),
  "utf8",
);

test("first install resolves Store, Configuration, billing, then queues primary generation", () => {
  const hookStart = shopifySource.indexOf("afterAuth:");
  const hookEnd = shopifySource.indexOf("future:", hookStart);
  const hook = shopifySource.slice(hookStart, hookEnd);

  const store = hook.indexOf("upsertInstalledStore");
  const configuration = hook.indexOf("ensureConfigurationForSession");
  const subscription = hook.indexOf("getSubscriptionForSession");
  const primary = hook.indexOf("requestPrimaryFeedInstallBootstrap");

  assert.ok(store >= 0);
  assert.ok(store < configuration);
  assert.ok(configuration < subscription);
  assert.ok(subscription < primary);
  assert.match(hook, /subscription\.canUseApp/);
  assert.match(
    backendClientSource,
    /"POST",\s*"\/api\/feeds\/primary\/bootstrap"/,
  );
});

test("reinstall reuses Configuration and never resets its stored fields", () => {
  const start = configurationSource.indexOf(
    "export async function ensureConfigurationForSession",
  );
  const end = configurationSource.indexOf(
    "export async function getConfigurationPageData",
    start,
  );
  const ensureConfiguration = configurationSource.slice(start, end);

  assert.match(
    ensureConfiguration,
    /if \(existingConfiguration\)[\s\S]*return \{[\s\S]*configuration:/,
  );
  assert.match(
    ensureConfiguration,
    /configuration\.upsert\([\s\S]*update: \{\}/,
  );
  assert.doesNotMatch(
    ensureConfiguration,
    /existingConfiguration[\s\S]*configuration\.(delete|deleteMany)/,
  );
});

test("the app home retries idempotent setup if post-authentication bootstrap was unavailable", () => {
  assert.match(homeRouteSource, /subscription\?\.canUseApp/);
  assert.match(
    homeRouteSource,
    /ensureConfigurationForSession\(admin, session\)[\s\S]*requestPrimaryFeedInstallBootstrap\(session\)/,
  );
});

test("a queued persisted primary record shows generation state instead of a generate action", () => {
  assert.match(
    feedsPanelSource,
    /primaryGenerationInProgress \? \([\s\S]*Generating[\s\S]*\) : \([\s\S]*Generate XML feed/,
  );
});

test("the feed read path self-heals a primary reset by overlapping uninstall cleanup", () => {
  assert.match(
    feedDataRouteSource,
    /result\.feed\?\.status === "NOT_GENERATED"[\s\S]*requestPrimaryFeedInstallBootstrap/,
  );
});

test("a delayed uninstall webhook cannot disable a newer reinstall", () => {
  assert.match(uninstallWebhookSource, /x-shopify-triggered-at/);
  assert.match(
    uninstallWebhookSource,
    /markStoreUninstalled\(shop, uninstalledAt\)[\s\S]*marked\.count === 0/,
  );
  assert.match(
    storeServiceSource,
    /installedAt: \{ lte: uninstalledAt \}[\s\S]*status: "INSTALLED"/,
  );
});
