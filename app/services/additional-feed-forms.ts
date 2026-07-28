import type {
  AdditionalFeedEntry,
  AdditionalLanguageOption,
  AdditionalMarketOption,
} from "../routes/app.additional-feeds";

export interface AdditionalMarketFormState {
  error: string | null;
  id: string;
  market: AdditionalMarketOption | null;
  pendingFeedId: string | null;
  language: AdditionalLanguageOption | null;
}

export function createAdditionalMarketForm(
  id: string,
): AdditionalMarketFormState {
  return {
    error: null,
    id,
    language: null,
    market: null,
    pendingFeedId: null,
  };
}

export function additionalFormCombinationKey(
  market: AdditionalMarketOption,
  language: AdditionalLanguageOption,
) {
  return `${market.marketId}\u0000${market.countryCode.toUpperCase()}\u0000${language.locale.toLocaleLowerCase()}`;
}

export function selectedAdditionalFormCombinations(
  forms: AdditionalMarketFormState[],
  ignoredFormId?: string,
) {
  return new Set(
    forms.flatMap((form) =>
      form.id !== ignoredFormId && form.market && form.language
        ? [additionalFormCombinationKey(form.market, form.language)]
        : [],
    ),
  );
}

export function availableLanguagesForForm(
  languages: AdditionalLanguageOption[],
  market: AdditionalMarketOption,
  forms: AdditionalMarketFormState[],
  formId: string,
) {
  const reserved = selectedAdditionalFormCombinations(forms, formId);
  return languages.filter(
    (language) =>
      !reserved.has(additionalFormCombinationKey(market, language)),
  );
}

export function reconcileAdditionalMarketForms(
  forms: AdditionalMarketFormState[],
  feeds: AdditionalFeedEntry[],
) {
  let changed = false;
  const reconciled: AdditionalMarketFormState[] = [];

  for (const form of forms) {
    const entry = form.pendingFeedId
      ? feeds.find(({ feed }) => feed.id === form.pendingFeedId)
      : null;

    if (entry?.feed.status === "COMPLETED") {
      changed = true;
      continue;
    }

    const generatedCombination = form.market && form.language
      ? feeds.find(
          ({ feed, market }) =>
            feed.id !== form.pendingFeedId &&
            market.id === form.market?.marketId &&
            market.countryCode?.toUpperCase() ===
              form.market?.countryCode.toUpperCase() &&
            market.locale.toLocaleLowerCase() ===
              form.language?.locale.toLocaleLowerCase(),
        )
      : null;
    if (generatedCombination) {
      changed = true;
      reconciled.push({
        ...form,
        error: null,
        language: null,
        pendingFeedId: null,
      });
      continue;
    }

    if (
      entry?.feed.status === "FAILED" &&
      form.error !==
        (entry.feed.lastError || "The feed generation failed. Try again.")
    ) {
      changed = true;
      reconciled.push({
        ...form,
        error:
          entry.feed.lastError || "The feed generation failed. Try again.",
      });
      continue;
    }

    reconciled.push(form);
  }

  return changed ? reconciled : forms;
}

export function visibleAdditionalFeedEntries(
  feeds: AdditionalFeedEntry[],
  forms: AdditionalMarketFormState[],
) {
  const formFeedIds = new Set(
    forms
      .map(({ pendingFeedId }) => pendingFeedId)
      .filter((feedId): feedId is string => Boolean(feedId)),
  );

  return feeds.filter(({ feed }) => !formFeedIds.has(feed.id));
}
