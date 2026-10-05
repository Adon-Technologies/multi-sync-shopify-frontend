import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticateActiveAdmin } from "../shopify.server";
import { getReviewClickStatus, recordReviewClick } from "../services/review-click.server";

const headers = { "Cache-Control": "no-store" };
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticateActiveAdmin(request);
  return Response.json(await getReviewClickStatus(session.shop), { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const context = await authenticateActiveAdmin(request);
  try {
    // Client-provided shop, user, email and rating values are never used.
    return Response.json(await recordReviewClick(request, context), { headers });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[review-click] capture failed", { category: error instanceof Error ? error.name : "UNKNOWN" });
    return Response.json({ error: "Your App Store visit couldn't be saved. Please try again." }, { status: 503, headers });
  }
}
