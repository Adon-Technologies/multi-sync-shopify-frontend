import type { XmlLink } from "@prisma/client";

import prisma from "../db.server";
import type {
  FeedMarket,
  FeedMetadata,
} from "../routes/app.feed-data";
import { upsertInstalledStore } from "./store.server";

interface FeedSession {
  accessToken?: string;
  shop: string;
}

function mapStoredFeed(feed: XmlLink): FeedMetadata {
  return {
    createdAt: feed.createdAt.toISOString(),
    fileSizeBytes: feed.fileSizeBytes?.toString() ?? null,
    generatedItems: feed.generatedItems,
    generationCompletedAt: feed.generationCompletedAt?.toISOString() ?? null,
    generationStartedAt: feed.generationStartedAt?.toISOString() ?? null,
    gcsObjectName: feed.gcsObjectName,
    id: feed.id,
    lastError: feed.lastError,
    lastRefreshedAt: feed.lastRefreshedAt?.toISOString() ?? null,
    processedProducts: feed.processedProducts,
    processedVariants: feed.processedVariants,
    publicUrl: feed.publicUrl,
    skippedItems: feed.skippedItems,
    status: feed.status,
    totalProducts: feed.totalProducts,
    updatedAt: feed.updatedAt.toISOString(),
  };
}

function mapStoredMarket(feed: XmlLink): FeedMarket {
  return {
    countryCode: feed.countryCode,
    countryName: feed.countryName,
    currencyCode: feed.currencyCode ?? "",
    currencyName: feed.currencyName,
    id: feed.marketId,
    locale: feed.locale,
    name: feed.marketName,
  };
}

/**
 * Reads only the authenticated shop's last saved Primary Feed metadata.
 * Generation and Shopify refreshes remain backend responsibilities.
 */
export async function getStoredPrimaryFeedMetadata(session: FeedSession) {
  const store = await upsertInstalledStore(session);
  const feed = await prisma.xmlLink.findFirst({
    where: { storeId: store.id },
    orderBy: { updatedAt: "desc" },
  });

  return {
    feed: feed ? mapStoredFeed(feed) : null,
    market: feed ? mapStoredMarket(feed) : null,
  };
}
