import { normalizeCountryCode } from "@multi-sync/catalog-rules";
import type { LoaderFunctionArgs } from "react-router";
import { authenticateSubscribedAdmin } from "../shopify.server";
import { getConfigurationPageData } from "./configuration.server";
import { requestFeedBackend } from "./feed-backend.server";
import type {
  AdditionalFeedEntry,
  AdditionalMarketOption,
  AdditionalLanguageOption,
  AdditionalFeedsResponse,
} from "../routes/app.additional-feeds";

export interface MarketEditorSettings {
  ok: true;
  entry: AdditionalFeedEntry;
  primaryConfiguration: Record<string, unknown>;
  customConfiguration: Record<string, unknown> | null;
}

export async function loadMarketFeedEditor({
  request,
  params,
}: LoaderFunctionArgs) {
  const { admin, session } = await authenticateSubscribedAdmin(request);
  const primary = await getConfigurationPageData(admin, session);
  const scope = { shop: session.shop, sessionId: session.id, locale: null };
  if (params.feedId) {
    const settings = await requestFeedBackend<MarketEditorSettings>(
      session,
      "GET",
      `/api/feeds/additional/${encodeURIComponent(params.feedId)}/configuration`,
    );
    return {
      scope,
      primary: primary.configuration,
      settings,
      options: [] as AdditionalMarketOption[],
      selection: null,
      creationPricing: null,
    };
  }
  const [markets, feeds] = await Promise.all([
    requestFeedBackend<{ options: AdditionalMarketOption[] }>(
      session, "GET", "/api/feeds/additional/options",
    ),
    requestFeedBackend<AdditionalFeedsResponse>(
      session, "GET", "/api/feeds/additional",
    ),
  ]);
  if (!feeds.ok || !feeds.usage?.nextFeedPricing)
    throw new Error("Your feed allowance could not be verified. Try again.");
  const creationPricing = feeds.usage.nextFeedPricing;
  const url = new URL(request.url);
  if (url.pathname.endsWith("/configure")) {
    const market = markets.options.find(
      (option) =>
        option.marketId === url.searchParams.get("marketId") &&
        option.countryCode === url.searchParams.get("countryCode"),
    );
    const idCountryCode = normalizeCountryCode(
      url.searchParams.get("idCountryCode"),
    );
    if (!market || !idCountryCode)
      throw new Response("Choose a valid market and Country Code.", {
        status: 400,
      });
    const languages = await requestFeedBackend<{
      languages: AdditionalLanguageOption[];
    }>(session, "POST", "/api/feeds/additional/languages", {
      marketId: market.marketId,
      countryCode: market.countryCode,
    });
    const language = languages.languages.find(
      (item) => item.locale === url.searchParams.get("locale"),
    );
    if (!language)
      throw new Response("Choose an available language for this market.", {
        status: 400,
      });
    return {
      scope,
      primary: primary.configuration,
      settings: null,
      options: markets.options,
      selection: { market, language, idCountryCode },
      creationPricing,
    };
  }
  return {
    scope,
    primary: primary.configuration,
    settings: null,
    options: markets.options,
    selection: null,
    creationPricing,
  };
}
