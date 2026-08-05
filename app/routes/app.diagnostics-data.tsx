import type { LoaderFunctionArgs } from "react-router";

import {
  getDiagnosticsCounts,
  getDiagnosticsFilterOptions,
  getDiagnosticsPage,
  type DiagnosticsCounts,
  type DiagnosticsFilterOptions,
  type DiagnosticsPage,
  type DiagnosticsTab,
} from "../services/diagnostics.server";
import {
  normalizeDiagnosticsFilter,
  normalizeDiagnosticsFilterField,
  type DiagnosticsFilterField,
} from "../services/diagnostics-filter";
import { normalizeDiagnosticsSort } from "../services/diagnostics-sort";
import { authenticateSubscribedAdmin } from "../shopify.server";

export type DiagnosticsDataResponse =
  | {
      ok: true;
      intent: "counts";
      counts: DiagnosticsCounts;
    }
  | {
      ok: true;
      intent: "filter-options";
      field: DiagnosticsFilterField;
      result: DiagnosticsFilterOptions;
    }
  | {
      ok: true;
      intent: "page";
      tab: DiagnosticsTab;
      page: DiagnosticsPage;
    }
  | {
      ok: false;
      intent: "counts" | "filter-options" | "page";
      error: string;
    };

const validTabs = new Set<DiagnosticsTab>([
  "all",
  "submitted",
  "warnings",
  "excluded",
]);

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<DiagnosticsDataResponse> => {
  const { admin, session } = await authenticateSubscribedAdmin(request);
  const url = new URL(request.url);
  const requestedIntent = url.searchParams.get("intent");
  const intent =
    requestedIntent === "counts"
      ? "counts"
      : requestedIntent === "filter-options"
        ? "filter-options"
        : "page";
  const force = url.searchParams.get("refresh") === "1";
  const refreshToken = url.searchParams.get("refreshToken");

  try {
    if (intent === "counts") {
      return {
        ok: true,
        intent,
        counts: await getDiagnosticsCounts(admin, session.shop, {
          force,
          refreshToken,
        }),
      };
    }

    const requestedTab = url.searchParams.get("tab") as DiagnosticsTab | null;
    const tab =
      requestedTab && validTabs.has(requestedTab) ? requestedTab : "all";

    if (intent === "filter-options") {
      const field = normalizeDiagnosticsFilterField(
        url.searchParams.get("field"),
      );

      if (!field) {
        return {
          ok: false,
          intent,
          error: "Filter options couldn't be loaded.",
        };
      }

      return {
        ok: true,
        intent,
        field,
        result: await getDiagnosticsFilterOptions(session.shop, {
          field,
          tab,
          snapshotVersion: url.searchParams.get("snapshotVersion"),
        }),
      };
    }

    return {
      ok: true,
      intent,
      tab,
      page: await getDiagnosticsPage(admin, session.shop, {
        tab,
        after: url.searchParams.get("after"),
        before: url.searchParams.get("before"),
        filter: normalizeDiagnosticsFilter(
          url.searchParams.get("filterField"),
          url.searchParams.get("filterValue"),
        ),
        force,
        refreshToken,
        search: url.searchParams.get("search"),
        sort: normalizeDiagnosticsSort(url.searchParams.get("sort")),
        snapshotVersion: url.searchParams.get("snapshotVersion"),
      }),
    };
  } catch (error) {
    console.error("Diagnostics data request failed", error);

    return {
      ok: false,
      intent,
      error:
        intent === "counts"
          ? "Diagnostic totals couldn't be calculated. Refresh to try again."
          : intent === "filter-options"
            ? "Filter options couldn't be loaded. Try again."
            : "Products couldn't be loaded. Refresh to try again.",
    };
  }
};
