import { Session } from "@shopify/shopify-api";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { getReviewClickStatus, recordReviewClick, redactReviewClicks, REVIEW_CLICK_EVENT } from "../app/services/review-click.server";
import { action, loader } from "../app/routes/app.review-click";
import { SHOPIFY_APP_STORE_URL } from "../app/services/shopify-reviews";

const db = vi.hoisted(() => ({
  store: { findUnique: vi.fn(), findFirst: vi.fn() },
  feedback: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const authenticate = vi.hoisted(() => vi.fn());
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/shopify.server", () => ({ authenticateActiveAdmin: authenticate }));
const domain = "store.myshopify.com";
const storeId = "6aacf2fd98c7a808280d782d";
const admin = { graphql: vi.fn() };
const clicker = { id: 12345, first_name: "Staff", last_name: "Member", email: "staff@example.com", email_verified: true, account_owner: false, collaborator: true, locale: "en" };
let requestFetch: ReturnType<typeof vi.fn>;
const context = () => ({ admin, session: new Session({ id: `offline_${domain}`, shop: domain, isOnline: false, state: "" }), sessionToken: { sub: "12345" } });
const request = () => new Request("https://app.example.com/app/review-click", { method: "POST", headers: { Authorization: "Bearer authenticated-id-token" } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_KEY", "test-key");
  vi.stubEnv("SHOPIFY_API_SECRET", "test-secret");
  db.store.findUnique.mockResolvedValue({ id: storeId, shopDomain: domain, status: "INSTALLED", accessStatus: "ACTIVE" });
  db.feedback.findFirst.mockResolvedValue(null);
  db.feedback.findUnique.mockResolvedValue(null);
  db.feedback.create.mockResolvedValue({ id: "click" });
  db.user.findUnique.mockResolvedValue(null);
  admin.graphql.mockResolvedValue(Response.json({ data: { shop: { id: "gid://shopify/Shop/987", name: "Example Store", email: "owner@example.com", contactEmail: "contact@example.com", primaryDomain: { url: "https://example.com" } } } }));
  requestFetch = vi.fn().mockResolvedValue(Response.json({ access_token: "must-not-be-stored", associated_user: clicker }));
  vi.stubGlobal("fetch", requestFetch);
  authenticate.mockImplementation(async () => context());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("persists actual clicker and store snapshots in Feedback, leaving rating/message empty", async () => {
  db.user.findUnique.mockResolvedValue({ id: "6aacf2fd98c7a808280d7000" });
  expect(await recordReviewClick(request(), context())).toEqual({ clicked: true });
  expect(db.feedback.create).toHaveBeenCalledTimes(1);
  const { data } = db.feedback.create.mock.calls[0][0];
  expect(data).toMatchObject({
    storeId, userId: "6aacf2fd98c7a808280d7000", shopifyUserId: "12345",
    userName: "Staff Member", email: "staff@example.com", emailVerified: true,
    accountOwner: false, collaborator: true, storeName: "Example Store",
    shopDomain: domain, storeDomain: "https://example.com", shopifyStoreId: "gid://shopify/Shop/987",
    storeEmail: "owner@example.com", storeContactEmail: "contact@example.com",
    submissionId: "app-store-review-click:12345", eventType: REVIEW_CLICK_EVENT,
    appStoreUrl: SHOPIFY_APP_STORE_URL, hasMessage: false,
  });
  expect(data.clickedAt).toBeInstanceOf(Date);
  expect(data.rating).toBeUndefined(); expect(data.message).toBeUndefined();
  expect(JSON.stringify(data)).not.toMatch(/test-secret|authenticated-id-token|must-not-be-stored|access_token/);
  const [url, options] = requestFetch.mock.calls[0];
  expect(url).toBe(`https://${domain}/admin/oauth/access_token`);
  expect(options.body.get("requested_token_type")).toBe("urn:shopify:params:oauth:token-type:online-access-token");
  expect(options.body.get("subject_token")).toBe("authenticated-id-token");
});

it("uses a matching online session without minting another token", async () => {
  const ctx = context();
  ctx.session.onlineAccessInfo = { associated_user: clicker, associated_user_scope: "", expires_in: 3600 };
  await recordReviewClick(request(), ctx);
  expect(requestFetch).not.toHaveBeenCalled();
  expect(db.feedback.create.mock.calls[0][0].data.email).toBe(clicker.email);
});

it("does not trust a different online-session user", async () => {
  const ctx = context();
  ctx.session.onlineAccessInfo = { associated_user: { ...clicker, id: 777 }, associated_user_scope: "", expires_in: 3600 };
  await recordReviewClick(request(), ctx);
  expect(requestFetch).toHaveBeenCalledTimes(1);
  expect(db.feedback.create.mock.calls[0][0].data.shopifyUserId).toBe("12345");
});

it("does not create a dashboard account or confuse a store email with the clicker's email", async () => {
  await recordReviewClick(request(), context());
  expect(db.feedback.create.mock.calls[0][0].data.userId).toBeNull();
  expect(db.user.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { email: "staff@example.com" }, select: { id: true } });
});

it.each(["unavailable", "wrong-user", "no-bearer"])("retains verified user/store IDs if user enrichment is %s", async failure => {
  if (failure === "unavailable") requestFetch.mockRejectedValue(new Error("Secret response details"));
  if (failure === "wrong-user") requestFetch.mockResolvedValue(Response.json({ associated_user: { ...clicker, id: 999 } }));
  const req = failure === "no-bearer" ? new Request(request().url, { method: "POST" }) : request();
  await recordReviewClick(req, context());
  expect(db.feedback.create.mock.calls[0][0].data).toMatchObject({ storeId, shopifyUserId: "12345", email: null, userName: null, userId: null });
  expect(db.user.findUnique).not.toHaveBeenCalled();
});

it("doesn't use an unverified email to link a dashboard account", async () => {
  requestFetch.mockResolvedValue(Response.json({ associated_user: { ...clicker, email_verified: false } }));
  await recordReviewClick(request(), context());
  expect(db.user.findUnique).not.toHaveBeenCalled();
  expect(db.feedback.create.mock.calls[0][0].data).toMatchObject({ email: clicker.email, emailVerified: false, userId: null });
});

it("retains IDs even if the Shopify shop query fails", async () => {
  admin.graphql.mockRejectedValue(new Error("Unavailable"));
  await recordReviewClick(request(), context());
  expect(db.feedback.create.mock.calls[0][0].data).toMatchObject({ storeId, shopDomain: domain, storeName: null, storeEmail: null });
});

it("doesn't recreate or enrich an already recorded click", async () => {
  db.feedback.findUnique.mockResolvedValue({ id: "existing" });
  expect(await recordReviewClick(request(), context())).toEqual({ clicked: true });
  expect(db.feedback.create).not.toHaveBeenCalled();
  expect(requestFetch).not.toHaveBeenCalled(); expect(admin.graphql).not.toHaveBeenCalled();
});

it("handles a simultaneous duplicate using the collection's existing unique index", async () => {
  db.feedback.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "other-request" });
  db.feedback.create.mockRejectedValue({ code: "P2002" });
  expect(await recordReviewClick(request(), context())).toEqual({ clicked: true });
});

it("does not suppress unrelated database failures", async () => {
  db.feedback.create.mockRejectedValue(new Error("Write failed"));
  await expect(recordReviewClick(request(), context())).rejects.toThrow("Write failed");
});

it("checks only this store's click events, ignoring old private Feedback records", async () => {
  expect(await getReviewClickStatus(domain)).toEqual({ clicked: false });
  expect(db.feedback.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { storeId, eventType: REVIEW_CLICK_EVENT }, select: { id: true } });
  db.feedback.findFirst.mockResolvedValue({ id: "click" });
  expect(await getReviewClickStatus(domain)).toEqual({ clicked: true });
});

it.each(["missing", "uninstalled", "suspended"])("rejects a %s store before saving", async scenario => {
  db.store.findUnique.mockResolvedValue(scenario === "missing" ? null : {
    id: storeId, shopDomain: domain,
    status: scenario === "uninstalled" ? "UNINSTALLED" : "INSTALLED",
    accessStatus: scenario === "suspended" ? "SUSPENDED" : "ACTIVE",
  });
  await expect(recordReviewClick(request(), context())).rejects.toMatchObject({ status: 403 });
  expect(db.feedback.create).not.toHaveBeenCalled();
});

it("rejects an absent validated user identity", async () => {
  await expect(recordReviewClick(request(), { ...context(), sessionToken: { sub: "" } })).rejects.toMatchObject({ status: 401 });
  expect(db.feedback.create).not.toHaveBeenCalled();
});

it("authenticates the route and ignores forged client identity/rating fields", async () => {
  const req = new Request(request().url, { method: "POST", headers: request().headers, body: JSON.stringify({ shop: "other.myshopify.com", userId: "999", email: "forged@example.com", rating: 5 }) });
  const response = await action({ request: req, params: {}, context: {}, unstable_pattern: "/app/review-click" });
  expect(authenticate).toHaveBeenCalledExactlyOnceWith(req);
  expect(await response.json()).toEqual({ clicked: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(db.feedback.create.mock.calls[0][0].data).toMatchObject({ shopDomain: domain, shopifyUserId: "12345", email: clicker.email });
});

it("requires authentication for both status and clicks", async () => {
  authenticate.mockRejectedValue(new Response(null, { status: 401 }));
  const args = { request: request(), params: {}, context: {}, unstable_pattern: "/app/review-click" };
  await expect(action(args)).rejects.toMatchObject({ status: 401 });
  await expect(loader(args)).rejects.toMatchObject({ status: 401 });
  expect(db.feedback.findFirst).not.toHaveBeenCalled(); expect(db.feedback.create).not.toHaveBeenCalled();
});

it("returns only click status from the loader, without exposing identity", async () => {
  db.feedback.findFirst.mockResolvedValue({ id: "click" });
  const response = await loader({ request: new Request(request().url), params: {}, context: {}, unstable_pattern: "/app/review-click" });
  expect(await response.json()).toEqual({ clicked: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("rejects unsupported action methods", async () => {
  const response = await action({ request: new Request(request().url, { method: "DELETE" }), params: {}, context: {}, unstable_pattern: "/app/review-click" });
  expect(response.status).toBe(405);
  expect(authenticate).not.toHaveBeenCalled();
});

it("redacts only click events for the matching uninstall marker", async () => {
  db.store.findFirst.mockResolvedValue({ id: storeId });
  const uninstalledAt = new Date();
  await redactReviewClicks(domain, uninstalledAt);
  expect(db.store.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { shopDomain: domain, status: "UNINSTALLED", uninstalledAt }, select: { id: true } });
  expect(db.feedback.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { storeId, eventType: REVIEW_CLICK_EVENT, createdAt: { lte: uninstalledAt } } });
});

it("skips a redaction superseded by a reinstall", async () => {
  db.store.findFirst.mockResolvedValue(null);
  await redactReviewClicks(domain, new Date());
  expect(db.feedback.deleteMany).not.toHaveBeenCalled();
});
