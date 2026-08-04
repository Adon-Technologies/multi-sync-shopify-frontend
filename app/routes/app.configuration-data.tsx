import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { searchShopCollections } from "../services/collection-search.server";
import {
  AttributeRuleScopeError,
  getAttributeRuleJobStatusesForShop,
  getConfigurationPageData,
  retryAttributeRulesForShop,
  saveAttributeRulesForShop,
  saveConfigurationForShop,
} from "../services/configuration.server";
import { AttributeRulesValidationError } from "../services/attribute-rules";
import { ConfigurationValidationError } from "../services/configuration-validation";
import { getShopVariantOptionNames } from "../services/variant-option-discovery.server";
import {
  getActiveShopifyLocations,
  InventoryLocationVerificationError,
} from "../services/shopify-locations.server";
import { authenticateActiveAdmin } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticateActiveAdmin(request);
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent");

  try {
    if (intent === "collections") {
      const page = await searchShopCollections(
        admin,
        url.searchParams.get("search"),
        url.searchParams.get("after"),
      );

      return Response.json({ ok: true, intent: "collections", page });
    }

    if (intent === "option-names") {
      const optionNames = await getShopVariantOptionNames(admin, session.shop);
      return Response.json({ ok: true, intent, optionNames });
    }

    if (intent === "rule-status") {
      const ruleJobs = await getAttributeRuleJobStatusesForShop(session);
      return Response.json({ ok: true, intent, ruleJobs });
    }

    if (intent === "locations") {
      const locations = await getActiveShopifyLocations(admin, session.shop);
      return Response.json({ ok: true, intent, locations });
    }

    const data = await getConfigurationPageData(admin, session);
    return Response.json({ ok: true, intent: "configuration", ...data });
  } catch (error) {
    console.error("Configuration data request failed", error);
    return Response.json(
      {
        ok: false,
        error:
          intent === "collections"
            ? "Collections couldn't be loaded. Try again."
            : intent === "option-names"
              ? "Product option names couldn't be loaded. Try again."
              : intent === "locations"
                ? "Shopify locations couldn't be loaded. Try again."
                : "Configuration couldn't be loaded. Try again.",
      },
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticateActiveAdmin(request);

  try {
    const value = (await request.json()) as unknown;
    const input =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const result =
      input?.intent === "save-attribute-rules" &&
      (input.kind === "gender" || input.kind === "age")
        ? await saveAttributeRulesForShop(
            admin,
            session,
            input.kind,
            input.configuration,
          )
        : input?.intent === "retry-attribute-rules" &&
            (input.kind === "gender" || input.kind === "age")
          ? await retryAttributeRulesForShop(session, input.kind)
          : await saveConfigurationForShop(admin, session, value);

    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (
      error instanceof ConfigurationValidationError ||
      error instanceof AttributeRulesValidationError ||
      error instanceof InventoryLocationVerificationError
    ) {
      return Response.json(
        {
          ok: false,
          error: error.message,
          ...(error instanceof ConfigurationValidationError ||
          error instanceof InventoryLocationVerificationError
            ? { fields: error.fields }
            : {}),
        },
        { status: 400 },
      );
    }

    if (error instanceof AttributeRuleScopeError) {
      return Response.json(
        { ok: false, error: error.message },
        { status: 403 },
      );
    }

    console.error("Configuration save failed", error);
    return Response.json(
      {
        ok: false,
        error: "Configuration couldn't be saved. Try again.",
      },
      { status: 500 },
    );
  }
};
