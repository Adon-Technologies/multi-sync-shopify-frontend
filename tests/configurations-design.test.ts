import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
  new URL("../app/components/ConfigurationsPanel.tsx", import.meta.url),
  "utf8",
);
const panelStyles = readFileSync(
  new URL("../app/styles/configurations.module.css", import.meta.url),
  "utf8",
);

test("the compact Attributes and Exclusions editor exposes four accessible View actions", () => {
  const labels = [
    "View and edit Color options",
    "View and edit Size options",
    "View and edit excluded collections",
    "View and edit excluded product titles",
  ];

  for (const label of labels) {
    assert.match(panelSource, new RegExp(`viewAccessibilityLabel="${label}"`));
  }

  assert.match(panelSource, /command="--show"[\s\S]*commandFor=\{viewTarget\}/);
});

test("all four editors use named Polaris modals and removable Polaris chips", () => {
  for (const heading of ["Excluded collections", "Excluded product titles"]) {
    assert.match(
      panelSource,
      new RegExp(`<s-modal\\s+[\\s\\S]*?heading="${heading}"`),
    );
  }

  assert.match(panelSource, /heading=\{`\$\{attribute\} options`\}/);
  assert.equal(panelSource.match(/<s-clickable-chip/g)?.length, 3);
  assert.equal(panelSource.match(/removable/g)?.length, 3);
});

test("dialog edits remain drafts until Confirm and main fields show compact summaries", () => {
  assert.match(panelSource, /setDraftValue\(value\)/);
  assert.match(
    panelSource,
    /onClick=\{\(\) => onChange\(normalizeOptionNames\(draftValue\)\)\}/,
  );
  assert.match(panelSource, /onClick=\{\(\) => onChange\(draftValue\)\}/);
  assert.match(panelSource, /\$\{value\.length\} option name/);
  assert.match(panelSource, /\$\{value\.length\} collection/);
  assert.match(panelSource, /\$\{value\.length\} title term/);
});

test("Google feed checkboxes use a responsive two-column grid", () => {
  assert.match(
    panelStyles,
    /\.googleFeedOptionsGrid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    panelStyles,
    /@media \(max-width: 760px\)[\s\S]*\.googleFeedOptionsGrid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );

  for (const label of [
    "Show sale price in Google feed",
    "Include shipping weight in Google feed",
    "Use product image as main image",
    "Exclude out of stock items",
  ]) {
    assert.match(panelSource, new RegExp(`label="${label}"`));
  }
});

test("Inventory and Availability is a Polaris card between feed attributes and URL options", () => {
  const attributes = panelSource.indexOf(
    '<s-section heading="Attributes and Exclusions">',
  );
  const inventory = panelSource.indexOf(
    '<s-section heading="Inventory & Availability">',
  );
  const urlOptions = panelSource.indexOf(
    '<s-section heading="URL Options">',
  );

  assert.ok(attributes >= 0 && attributes < inventory);
  assert.ok(inventory < urlOptions);
  assert.match(
    panelSource,
    /label="Ignore Shopify inventory in Google feed"/,
  );
  assert.match(
    panelSource,
    /heading="Google may compare feed availability with your website"[\s\S]*tone="warning"/,
  );
  assert.match(
    panelSource,
    /Out-of-stock exclusion is ignored while this option is[\s\S]*enabled\./,
  );
  assert.match(panelSource, /<s-choice-list[\s\S]*value="ALL_LOCATIONS"/);
  assert.match(panelSource, /value="SELECTED_LOCATIONS"/);
  assert.match(panelSource, /Loading Shopify locations/);
  assert.match(panelSource, /Shopify locations couldn&apos;t be loaded/);
  assert.match(panelSource, /No active Shopify locations are available/);
  assert.match(
    panelSource,
    /If empty, inventory from all locations will be used\./,
  );
});

test("the contextual Save button uses Shopify's loading spinner while saving", () => {
  assert.match(
    panelSource,
    /const saveInProgress = isSaving \|\| saveMutation\.isPending;/,
  );
  assert.match(
    panelSource,
    /loading=\{saveInProgress \? "" : undefined\}[\s\S]*variant="primary"[\s\S]*>\s*Save\s*<\/button>/,
  );
  assert.doesNotMatch(panelSource, /Saving…/);
});

test("Gender and Age rule dialogs keep one full-dialog scrollbar", () => {
  assert.match(
    panelStyles,
    /\.rulesModalContent\s*\{[\s\S]*max-height:[^;]+;[\s\S]*overflow-y:\s*auto;/,
  );
  const rulesList = panelStyles.match(/\.rulesList\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(rulesList, /overflow-y|max-height/);
});

test("a saved configuration that made XML stale shows its warning at the top", () => {
  const headerStart = panelSource.indexOf(`<div className={styles.header}>`);
  const warningStart = panelSource.indexOf(
    `heading="XML feed refresh required"`,
  );
  const cardsStart = panelSource.indexOf(`<div className={styles.cards}>`);

  assert.ok(headerStart >= 0);
  assert.ok(warningStart > headerStart && warningStart < cardsStart);
  assert.match(panelSource, /configurationQuery\.data\?\.feedRefreshRequired/);
  assert.match(
    panelSource,
    /published XML still[\s\S]*uses the previous settings/,
  );
  assert.match(panelSource, /refetchType: "all"/);
});
