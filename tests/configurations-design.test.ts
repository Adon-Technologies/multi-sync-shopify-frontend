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
const attributeRulesSource = readFileSync(
  new URL("../app/components/AttributeRulesCard.tsx", import.meta.url),
  "utf8",
);

test("the compact Attributes and Exclusions editor exposes five accessible View actions", () => {
  const labels = [
    "View and edit Color options",
    "View and edit Size options",
    "View and edit excluded collections",
    "View and edit excluded product titles",
    "View and edit configured product types",
  ];

  for (const label of labels) {
    assert.match(panelSource, new RegExp(`viewAccessibilityLabel="${label}"`));
  }

  assert.match(panelSource, /command="--show"[\s\S]*commandFor=\{viewTarget\}/);
});

test("all five editors use Polaris modals and removable Polaris chips", () => {
  assert.match(panelSource, /<s-modal[\s\S]*?heading="Excluded collections"/);
  assert.match(panelSource, /heading=\{`\$\{attribute\} options`\}/);
  assert.match(panelSource, /<s-modal[\s\S]*?heading=\{heading\}/);
  assert.match(panelSource, /heading="Excluded product titles"/);
  assert.match(panelSource, /heading="Product types"/);
  assert.equal(panelSource.match(/<s-clickable-chip/g)?.length, 3);
  assert.equal(panelSource.match(/removable/g)?.length, 3);
});

test("dialog edits remain drafts until Confirm and main fields show compact summaries", () => {
  assert.match(panelSource, /setDraftValue\(value\)/);
  assert.match(
    panelSource,
    /onClick=\{\(\) => onChange\(normalizeOptionNames\(draftValue\)\)\}/,
  );
  assert.match(
    panelSource,
    /onClick=\{\(\) => onChange\(normalize\(draftValue\)\)\}/,
  );
  assert.match(panelSource, /\$\{value\.length\} option name/);
  assert.match(panelSource, /\$\{value\.length\} collection/);
  assert.match(panelSource, /\$\{count\} title term/);
  assert.match(panelSource, /\$\{count\} product type/);
});

test("Product Type reuses the draft dialog workflow below Exclude collection", () => {
  const excludeCollection = panelSource.indexOf('title="Exclude collection"');
  const productType = panelSource.indexOf('title="Add Product type"');
  const titleExclusion = panelSource.indexOf(
    'title="Exclude product by title"',
  );

  assert.ok(excludeCollection >= 0);
  assert.ok(productType > excludeCollection);
  assert.ok(productType > titleExclusion);
  assert.match(panelSource, /fieldLabel="Product type"/);
  assert.match(panelSource, /placeholder="Type to add product type"/);
  assert.match(panelSource, /inputName="productTypeDraft"/);
  assert.match(panelSource, /onSubmit=\{\(event\) => \{/);
  assert.match(panelSource, /setDraftValue\(\(current\) =>/);
  assert.match(panelSource, /This product type has already been added\./);
  assert.match(panelSource, /Enter a value before adding it\./);
  assert.match(panelSource, />\s*Confirm\s*<\/s-button>/);
  assert.match(panelSource, />\s*Cancel\s*<\/s-button>/);
});

test("saving Configuration invalidates Product Type suggestions", () => {
  assert.match(panelSource, /configurationKeys\.productTypes\(scope\)/);
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
  const urlOptions = panelSource.indexOf('<s-section heading="URL Options">');

  assert.ok(attributes >= 0 && attributes < inventory);
  assert.ok(inventory < urlOptions);
  assert.match(panelSource, /label="Ignore Shopify inventory in Google feed"/);
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

test("collection rule search explains matches already assigned to another rule", () => {
  assert.match(attributeRulesSource, /Used in another rule/);
  assert.match(
    attributeRulesSource,
    /disabled=\{[\s\S]*unavailableCollectionIds\.has\(collection\.id\)/,
  );
});

test("collection pickers restore cached results whenever they reopen", () => {
  assert.match(
    panelSource,
    /\[collectionsQuery\.data, cursor, debouncedSearch, isOpen\]/,
  );
  assert.match(
    attributeRulesSource,
    /\[cursor, debouncedSearch, open, query\.data\]/,
  );
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
  assert.match(panelSource, /refetchOnMount: "always"/);
  assert.match(
    panelSource,
    /published XML still[\s\S]*uses the previous settings/,
  );
  assert.match(panelSource, /onClick=\{onOpenFeeds\}/);
  assert.match(panelSource, />\s*Open Feeds\s*<\/s-button>/);
  assert.match(panelSource, /styles\.xmlRefreshWarningContent/);
  assert.match(panelSource, /styles\.xmlRefreshWarningAction/);
  assert.match(panelSource, /variant="secondary"/);
  assert.match(
    panelStyles,
    /\.xmlRefreshWarningAction\s*\{[\s\S]*margin-inline-start:\s*auto/,
  );
  assert.match(panelSource, /refetchType: "all"/);
});
