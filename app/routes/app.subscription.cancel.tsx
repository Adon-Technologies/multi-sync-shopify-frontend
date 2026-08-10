import type { ActionFunctionArgs } from "react-router";

import { cancelSubscriptionForSession } from "../services/subscription.server";
import { authenticateActiveAdmin } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateActiveAdmin(request);
  try {
    return Response.json({
      ok: true,
      subscription: await cancelSubscriptionForSession(session),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Your subscription could not be canceled. Try again.";
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 503;
    return Response.json({ error: message, ok: false }, { status });
  }
};
