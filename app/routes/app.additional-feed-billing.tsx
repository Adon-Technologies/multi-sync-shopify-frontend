import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticateActiveAdmin } from "../shopify.server";
import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";

export type AdditionalFeedBillingEligibility =
  | { ok: true; requiresRenewal: false }
  | { ok: true; requiresRenewal: true; subscriptionId: string; url: string };

function failure(error: unknown) {
  return Response.json(
    {
      ok: false,
      error:
        error instanceof FeedBackendError
          ? error.message
          : "Your subscription could not be verified. Try again shortly.",
    },
    { status: error instanceof FeedBackendError ? error.status : 503 },
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticateActiveAdmin(request);
  try {
    return Response.json(
      await requestFeedBackend<AdditionalFeedBillingEligibility>(
        session,
        "GET",
        "/api/subscription/additional-feeds/eligibility",
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // This route must remain reachable if cancellation succeeded but its response was lost.
  const { session } = await authenticateActiveAdmin(request);
  const input = await request.json().catch(() => null);
  if (input?.confirmed !== true || typeof input?.subscriptionId !== "string")
    return Response.json(
      {
        ok: false,
        error: "Confirm cancellation and resubscription before continuing.",
      },
      { status: 400 },
    );
  try {
    return Response.json(
      await requestFeedBackend<{ ok: true; url: string }>(
        session,
        "POST",
        "/api/subscription/additional-feeds/renew",
        { confirmed: true, subscriptionId: input.subscriptionId },
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
