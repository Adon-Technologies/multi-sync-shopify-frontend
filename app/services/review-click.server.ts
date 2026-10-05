import type { Session } from "@shopify/shopify-api";
import prisma from "../db.server";
import { SHOPIFY_APP_STORE_URL } from "./shopify-reviews";

export const REVIEW_CLICK_EVENT = "APP_STORE_REVIEW_CLICK";
interface AdminClient { graphql(query: string): Promise<Response> }
interface ClickContext {
  admin: AdminClient;
  session: Session;
  sessionToken: { sub: string };
}
interface ClickUser {
  id: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_verified?: boolean;
  account_owner?: boolean;
  collaborator?: boolean;
}

async function activeStore(shopDomain: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, status: true, accessStatus: true },
  });
  if (!store || store.status !== "INSTALLED" || store.accessStatus !== "ACTIVE") {
    throw new Response("Store unavailable", { status: 403 });
  }
  return store;
}

export async function getReviewClickStatus(shopDomain: string) {
  const store = await activeStore(shopDomain);
  const click = await prisma.feedback.findFirst({
    where: { storeId: store.id, eventType: REVIEW_CLICK_EVENT }, select: { id: true },
  });
  return { clicked: Boolean(click) };
}

export async function redactReviewClicks(shopDomain: string, uninstalledAt: Date) {
  // Keep the existing uninstall/reinstall guard and don't affect historic
  // private Feedback or any new clicks after a later installation.
  const store = await prisma.store.findFirst({
    where: { shopDomain, status: "UNINSTALLED", uninstalledAt }, select: { id: true },
  });
  if (store) await prisma.feedback.deleteMany({
    where: { storeId: store.id, eventType: REVIEW_CLICK_EVENT, createdAt: { lte: uninstalledAt } },
  });
}

// The validated token subject identifies the clicker, including staff and
// collaborators. Never substitute the store owner for an offline session.
async function clickUser(request: Request, context: ClickContext): Promise<ClickUser | null> {
  const { session, sessionToken } = context;
  const existing = session.onlineAccessInfo?.associated_user;
  if (existing && String(existing.id) === sessionToken.sub) return existing;
  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || !process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) return null;
  try {
    // Get associated_user without read_users or changing offline auth.
    // The returned online access token is discarded, never persisted.
    const response = await fetch(`https://${session.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: bearer,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { associated_user?: ClickUser };
    return payload.associated_user && String(payload.associated_user.id) === sessionToken.sub
      ? payload.associated_user : null;
  } catch { return null; }
}

async function shopDetails(admin: AdminClient) {
  try {
    const response = await admin.graphql(`#graphql
      query ReviewClickShop { shop { id name email contactEmail primaryDomain { url } } }
    `);
    const result = await response.json() as {
      data?: { shop?: { id: string; name: string; email: string; contactEmail: string; primaryDomain?: { url: string } } };
      errors?: unknown[];
    };
    return response.ok && !result.errors?.length ? result.data?.shop ?? null : null;
  } catch { return null; }
}

export async function recordReviewClick(request: Request, context: ClickContext) {
  const { session, sessionToken } = context;
  if (!/^\d+$/.test(sessionToken.sub)) throw new Response("User unavailable", { status: 401 });
  const store = await activeStore(session.shop);
  const submissionId = `app-store-review-click:${sessionToken.sub}`;
  const where = { storeId_submissionId: { storeId: store.id, submissionId } };
  // Retries retain the original click timestamp and details.
  const existing = await prisma.feedback.findUnique({ where, select: { id: true } });
  if (existing) return { clicked: true };
  const [user, shop] = await Promise.all([clickUser(request, context), shopDetails(context.admin)]);
  const email = user?.email?.trim() || null;
  // Link an existing dashboard User only; never create a login for a click.
  const localUser = email && user?.email_verified
    ? await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } }) : null;
  const now = new Date();
  try {
    await prisma.feedback.create({ data: {
      storeId: store.id,
      userId: localUser?.id ?? null,
      shopifyUserId: sessionToken.sub,
      submissionId,
      eventType: REVIEW_CLICK_EVENT,
      userName: [user?.first_name, user?.last_name].filter(Boolean).join(" ") || null,
      email,
      emailVerified: user?.email_verified ?? null,
      accountOwner: user?.account_owner ?? null,
      collaborator: user?.collaborator ?? null,
      storeName: shop?.name ?? null,
      shopDomain: store.shopDomain,
      storeDomain: shop?.primaryDomain?.url ?? null,
      shopifyStoreId: shop?.id ?? null,
      storeEmail: shop?.email ?? null,
      storeContactEmail: shop?.contactEmail ?? null,
      appStoreUrl: SHOPIFY_APP_STORE_URL,
      clickedAt: now,
      createdAt: now,
      updatedAt: now,
      hasMessage: false,
    } });
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
    if (!await prisma.feedback.findUnique({ where, select: { id: true } })) throw error;
  }
  return { clicked: true };
}
