import assert from "node:assert/strict";
import test from "node:test";

import {
  availableLanguagesForForm,
  createAdditionalMarketForm,
  reconcileAdditionalMarketForms,
  selectedAdditionalFormCombinations,
  visibleAdditionalFeedEntries,
} from "../app/services/additional-feed-forms.ts";
import { shouldPollPrimaryFeed } from "../app/services/feed-generation-state.ts";
import type {
  AdditionalFeedEntry,
  AdditionalLanguageOption,
  AdditionalMarketOption,
} from "../app/routes/app.additional-feeds.tsx";

const canada: AdditionalMarketOption = {
  availableLanguageCount: 2,
  countryCode: "CA",
  countryName: "Canada",
  currencyCode: "CAD",
  marketId: "gid://shopify/Market/1",
  marketName: "Canada",
  value: "gid://shopify/Market/1|CA",
};
const english: AdditionalLanguageOption = {
  locale: "en",
  name: "English",
};
const french: AdditionalLanguageOption = {
  locale: "fr",
  name: "French",
};

function feedEntry(
  id: string,
  status: "COMPLETED" | "FAILED" | "PROCESSING",
  lastError: string | null = null,
  market: Partial<AdditionalFeedEntry["market"]> = {},
) {
  return {
    feed: { id, lastError, status },
    market,
  } as AdditionalFeedEntry;
}

test("three Add Market clicks create three stable independent forms", () => {
  const forms = ["one", "two", "three"].map(createAdditionalMarketForm);
  const selected = forms.map((form, index) =>
    index === 1
      ? { ...form, language: french, market: canada }
      : form,
  );
  const remaining = selected.filter(({ id }) => id !== "one");

  assert.deepEqual(forms.map(({ id }) => id), ["one", "two", "three"]);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0]?.id, "two");
  assert.equal(remaining[0]?.language?.locale, "fr");
  assert.equal(remaining[1]?.id, "three");
});

test("duplicate open combinations are unavailable but another language remains", () => {
  const first = {
    ...createAdditionalMarketForm("one"),
    language: english,
    market: canada,
  };
  const second = {
    ...createAdditionalMarketForm("two"),
    market: canada,
  };

  assert.equal(
    selectedAdditionalFormCombinations([first, second], "two").size,
    1,
  );
  assert.deepEqual(
    availableLanguagesForForm(
      [english, french],
      canada,
      [first, second],
      "two",
    ).map(({ locale }) => locale),
    ["fr"],
  );
});

test("successful generation removes only its form and failed generation stays retryable", () => {
  const forms = [
    {
      ...createAdditionalMarketForm("one"),
      language: english,
      market: canada,
      pendingFeedId: "feed-one",
    },
    {
      ...createAdditionalMarketForm("two"),
      language: french,
      market: canada,
      pendingFeedId: "feed-two",
    },
    createAdditionalMarketForm("three"),
  ];
  const reconciled = reconcileAdditionalMarketForms(forms, [
    feedEntry("feed-one", "COMPLETED"),
    feedEntry("feed-two", "FAILED", "Shopify request failed."),
  ]);

  assert.deepEqual(reconciled.map(({ id }) => id), ["two", "three"]);
  assert.equal(reconciled[0]?.language?.locale, "fr");
  assert.equal(reconciled[0]?.pendingFeedId, "feed-two");
  assert.equal(reconciled[0]?.error, "Shopify request failed.");
});

test("generated tables retain multiple rows while form-owned jobs stay separate", () => {
  const entries = [
    feedEntry("ready-one", "COMPLETED"),
    feedEntry("active", "PROCESSING"),
    feedEntry("ready-two", "COMPLETED"),
  ];
  const forms = [
    {
      ...createAdditionalMarketForm("one"),
      pendingFeedId: "active",
    },
  ];

  assert.deepEqual(
    visibleAdditionalFeedEntries(entries, forms).map(({ feed }) => feed.id),
    ["ready-one", "ready-two"],
  );
});

test("a newly generated combination is cleared from every other open form", () => {
  const form = {
    ...createAdditionalMarketForm("stale"),
    language: english,
    market: canada,
  };
  const reconciled = reconcileAdditionalMarketForms(
    [form],
    [
      feedEntry("generated", "COMPLETED", null, {
        countryCode: "CA",
        id: canada.marketId,
        locale: "en",
      }),
    ],
  );

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.market?.value, canada.value);
  assert.equal(reconciled[0]?.language, null);
  assert.equal(reconciled[0]?.error, null);
});

test("Primary metadata keeps polling while any store feed owns the lock", () => {
  const completedPrimaryWithActiveAdditional = {
    activeGeneration: {
      feedId: "additional",
      feedType: "ADDITIONAL",
      label: "Canada / Russian",
      status: "PROCESSING",
    },
    backendUnavailable: false,
    feed: { status: "COMPLETED" },
    market: null,
    marketUnavailable: false,
    ok: true,
  } as const;

  assert.equal(
    shouldPollPrimaryFeed(completedPrimaryWithActiveAdditional),
    true,
  );
  assert.equal(
    shouldPollPrimaryFeed({
      ...completedPrimaryWithActiveAdditional,
      activeGeneration: null,
    }),
    false,
  );
});
