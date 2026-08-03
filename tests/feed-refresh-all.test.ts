import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
  new URL("../app/components/FeedsPanel.tsx", import.meta.url),
  "utf8",
);
const querySource = readFileSync(
  new URL("../app/services/feed-query.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../app/routes/app.feed-refresh-all.tsx", import.meta.url),
  "utf8",
);

test("Feeds exposes one store-wide XML refresh action in the page header", () => {
  const headerStart = panelSource.indexOf(
    `<div className={styles.header}>`,
  );
  const alertStart = panelSource.indexOf(
    `<TabAlertNavigator alerts={tabAlerts} />`,
  );
  const buttonStart = panelSource.indexOf("Refresh all XMLs");

  assert.ok(headerStart >= 0);
  assert.ok(buttonStart > headerStart && buttonStart < alertStart);
  assert.match(panelSource, /icon="refresh"/);
  assert.match(panelSource, /loading=\{[\s\S]*refreshAllRunId/);
  assert.match(panelSource, /onClick=\{\(\) => refreshAllMutation\.mutate\(\)\}/);
});

test("the refresh-all action uses the durable backend batch endpoint", () => {
  assert.match(querySource, /endpoint = "\/app\/feed-refresh-all"/);
  assert.match(routeSource, /"POST",\s*"\/api\/feeds\/refresh-all"/);
  assert.match(
    routeSource,
    /"GET",\s*`\/api\/feeds\/refresh-all\/\$\{encodeURIComponent\(runId\)\}`/,
  );
  assert.match(panelSource, /activeGeneration: result\.activeGeneration/);
  assert.match(panelSource, /setRefreshAllRunId\(result\.runId\)/);
  assert.match(
    panelSource,
    /void Promise\.all\(\[refetchFeed\(\), refetchAdditionalFeeds\(\)\]\)/,
  );
});
