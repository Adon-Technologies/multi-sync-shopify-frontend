import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configurationServiceSource = readFileSync(
  new URL("../app/services/configuration.server.ts", import.meta.url),
  "utf8",
);
const configurationQuerySource = readFileSync(
  new URL("../app/services/configuration-query.ts", import.meta.url),
  "utf8",
);

test("every feed-relevant Configuration change invalidates published XML feeds", () => {
  const saveStart = configurationServiceSource.indexOf(
    "export async function saveConfigurationForShop",
  );
  const saveEnd = configurationServiceSource.indexOf(
    "export async function getDiagnosticsConfigurationRules",
    saveStart,
  );
  const saveSource = configurationServiceSource.slice(saveStart, saveEnd);

  assert.match(
    saveSource,
    /if \(shouldInvalidatePublishedFeeds\) \{[\s\S]*prisma\.xmlLink\.updateMany\([\s\S]*gcsObjectName: \{ not: null \}[\s\S]*data: \{ requiresRefresh: true \}/,
  );
  assert.match(
    saveSource,
    /configurationRequiresFeedRefresh\(previousInput, verifiedInput\)/,
  );
  assert.match(saveSource, /feedRefreshRequired: staleFeedCount > 0/);
});

test("configuration loading exposes persisted XML refresh state", () => {
  const loadStart = configurationServiceSource.indexOf(
    "export async function getConfigurationPageData",
  );
  const loadEnd = configurationServiceSource.indexOf(
    "export async function saveConfigurationForShop",
    loadStart,
  );
  const loadSource = configurationServiceSource.slice(loadStart, loadEnd);

  assert.match(
    loadSource,
    /prisma\.xmlLink\.count\([\s\S]*requiresRefresh: true/,
  );
  assert.match(loadSource, /feedRefreshRequired: staleFeedCount > 0/);
  assert.match(
    configurationQuerySource,
    /interface ConfigurationResponse \{[\s\S]*feedRefreshRequired: boolean;/,
  );
});
