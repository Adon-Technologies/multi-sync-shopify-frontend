import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../app/components/TabAlertNavigator.tsx", import.meta.url),
  "utf8",
);
const automaticRefreshSource = readFileSync(
  new URL("../app/components/AutomaticRefreshCard.tsx", import.meta.url),
  "utf8",
);
const panelSources = [
  "DashboardTabs.tsx",
  "FeedsPanel.tsx",
  "DiagnosticsPanel.tsx",
  "ConfigurationsPanel.tsx",
].map((fileName) =>
  readFileSync(
    new URL(`../app/components/${fileName}`, import.meta.url),
    "utf8",
  ),
);

test("the shared tab alert navigator renders one banner with cycling controls", () => {
  assert.equal(componentSource.match(/<s-banner/g)?.length, 1);
  assert.match(
    componentSource,
    /Alert \{currentIndex \+ 1\} of \{alerts\.length\}/,
  );
  assert.match(componentSource, />\s*Previous\s*<\/s-button>/);
  assert.match(componentSource, />\s*Next\s*<\/s-button>/);
  assert.match(
    componentSource,
    /setSelectedId\(alerts\[\(currentIndex \+ 1\) % alerts\.length\]\.id\)/,
  );
});

test("every main tab with error sources uses the shared navigator", () => {
  for (const source of panelSources) {
    assert.match(source, /<TabAlertNavigator alerts=\{tabAlerts\} \/>/);
  }
});

test("automatic refresh reports its errors to the Feeds tab navigator", () => {
  assert.match(
    automaticRefreshSource,
    /onAlertsChange\(automaticRefreshAlerts\)/,
  );
  assert.doesNotMatch(automaticRefreshSource, /<s-banner/);
});
