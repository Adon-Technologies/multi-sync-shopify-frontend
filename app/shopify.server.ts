import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { redirect as reactRouterRedirect } from "react-router";

import { cleanPlanSelectionReturnPath } from "./billing/types";
import { upsertInstalledStore } from "./services/store.server";
import { assertStoreAccessAllowed } from "./services/store-access.server";
import {
  getPlanSelectionForSession,
  getSubscriptionForSession,
} from "./services/subscription.server";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Shopify session storage");
}

if (
  !databaseUrl.startsWith("mongodb://") &&
  !databaseUrl.startsWith("mongodb+srv://")
) {
  throw new Error("DATABASE_URL must be a MongoDB connection string");
}

const databaseUrlWithoutQuery = databaseUrl.split("?", 1)[0];
const databaseName = decodeURIComponent(
  databaseUrlWithoutQuery.slice(databaseUrlWithoutQuery.lastIndexOf("/") + 1),
);

if (!databaseName) {
  throw new Error("DATABASE_URL must include a MongoDB database name");
}

// Shopify's adapter accepts a URL object, while MongoDB also supports
// multi-host connection strings that Node's URL class cannot parse.
const mongoConnectionUrl = {
  toString: () => databaseUrl,
} as URL;

const mongoSessionStorage = new MongoDBSessionStorage(
  mongoConnectionUrl,
  databaseName,
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: mongoSessionStorage,
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session }) => {
      await upsertInstalledStore(session, { allowReinstall: true });
      await getSubscriptionForSession(session, { force: true }).catch(
        (error) => {
          console.error("[billing] post-authentication sync failed", {
            category:
              error instanceof Error ? error.name : "UNKNOWN",
            shop: session.shop,
          });
        },
      );
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export async function authenticateActiveAdmin(request: Request) {
  const context = await shopify.authenticate.admin(request);
  await assertStoreAccessAllowed(context.session.shop);
  return context;
}
export async function authenticateSubscribedAdmin(request: Request) {
  const context = await authenticateActiveAdmin(request);
  const url = new URL(request.url);
  const returnedFromPlanSelection = url.searchParams.has("plan_handle");
  let subscription;
  try {
    subscription = await getSubscriptionForSession(context.session, {
      force:
        returnedFromPlanSelection || request.method !== "GET",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Your Shopify subscription could not be verified.";
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 503;
    throw Response.json(
      {
        code: "BILLING_VERIFICATION_UNAVAILABLE",
        error: message,
        ok: false,
      },
      { status },
    );
  }

  if (!subscription.canUseApp) {
    const planSelection = await getPlanSelectionForSession(
      context.session,
    );
    throw context.redirect(planSelection.url, { target: "_top" });
  }

  if (
    returnedFromPlanSelection &&
    url.pathname.replace(/\/+$/, "") === "/app"
  ) {
    throw reactRouterRedirect(cleanPlanSelectionReturnPath(request.url));
  }

  return { ...context, subscription };
}
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
