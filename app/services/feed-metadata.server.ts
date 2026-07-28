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

async function ensureLegacyPrimaryFeed(storeId: string) {
  const primary = await prisma.xmlLink.findFirst({
    where: {
      feedType: "PRIMARY",
      storeId,
    },
    select: { id: true },
  });
  if (primary) return;

  const legacy = await prisma.xmlLink.findFirst({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (legacy) {
    await prisma.xmlLink.update({
      where: { id: legacy.id },
      data: { feedType: "PRIMARY" },
    });
  }
}

function mapStoredFeed(feed: XmlLink): FeedMetadata {
  return {
    createdAt: feed.createdAt.toISOString(),
    feedType: feed.feedType,
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
    requiresRefresh: feed.requiresRefresh,
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
    languageName: feed.languageName,
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
  await ensureLegacyPrimaryFeed(store.id);
  const feed = await prisma.xmlLink.findFirst({
    where: {
      feedType: "PRIMARY",
      storeId: store.id,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    feed: feed ? mapStoredFeed(feed) : null,
    market: feed ? mapStoredMarket(feed) : null,
  };
}

export async function getStoredAdditionalFeedMetadata(session: FeedSession) {
  const store = await upsertInstalledStore(session);
  await ensureLegacyPrimaryFeed(store.id);
  const feeds = await prisma.xmlLink.findMany({
    where: {
      feedType: "ADDITIONAL",
      storeId: store.id,
    },
    orderBy: [{ marketName: "asc" }, { countryName: "asc" }, { locale: "asc" }],
  });

  return {
    activeGeneration: null,
    feeds: feeds.map((feed) => ({
      feed: mapStoredFeed(feed),
      market: mapStoredMarket(feed),
    })),
  };
}
