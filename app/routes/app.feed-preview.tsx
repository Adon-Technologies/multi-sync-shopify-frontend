import type { ActionFunctionArgs } from "react-router";
import { authenticateSubscribedAdmin } from "../shopify.server";
import { requestFeedBackend, FeedBackendError } from "../services/feed-backend.server";
import type { ProductFeedPreview } from "../services/feed-preview";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const { session } = await authenticateSubscribedAdmin(request);
  const headers = { "Cache-Control": "no-store" };
  const body = await request.json().catch(() => null) as { productId?: unknown } | null;
  if (!body || typeof body.productId !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(body.productId)) {
    return Response.json({ ok: false, error: "Select a valid Shopify product to preview." }, { status: 400, headers });
  }
  try {
    const data = await requestFeedBackend<ProductFeedPreview>(session, "POST", "/api/feeds/primary/preview", { productId: body.productId }, {
      readOnlyStore: true, signal: AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]),
    });
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof FeedBackendError ? error.message : "XML preview couldn't be generated. Close the dialog and try again." }, { status: error instanceof FeedBackendError ? error.status : 502, headers });
  }
}
