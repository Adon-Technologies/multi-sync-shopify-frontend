import type { ShouldRevalidateFunctionArgs } from "react-router";

export const appSections = [
  { id: "dashboard", label: "Dashboard" },
  { id: "feeds", label: "Feeds" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "configurations", label: "Configurations" },
  { id: "support", label: "Support" },
  { id: "plan", label: "Plan" },
] as const;

export type DashboardTabId = (typeof appSections)[number]["id"];

export function isDashboardTab(value: string | null): value is DashboardTabId {
  return appSections.some(({ id }) => id === value);
}

export function parseDashboardTab(value: string | null): DashboardTabId {
  return isDashboardTab(value) ? value : "dashboard";
}

export function dashboardTabFromLocation(location: {
  pathname: string;
  search: string;
}): DashboardTabId | null {
  const pathname = location.pathname.replace(/\/+$/, "");
  const section = pathname.startsWith("/app/") ? pathname.slice(5) : null;
  if (isDashboardTab(section)) return section;
  if (pathname !== "/app") return null;

  // Keep existing bookmarks and billing links using ?tab= working.
  const legacyTab = new URLSearchParams(location.search).get("tab");
  return isDashboardTab(legacyTab) ? legacyTab : null;
}

export function dashboardTabHref(tab: DashboardTabId, search = "", hash = "") {
  const params = new URLSearchParams(search);
  params.delete("tab");
  const query = params.toString();
  return `/app/${tab}${query ? `?${query}` : ""}${hash}`;
}

export function shouldRevalidateDashboard({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Section changes share the same loaded data. Mutations, explicit refreshes,
  // billing returns and changes to Shopify's session parameters still reload.
  if (
    (!formMethod || formMethod.toUpperCase() === "GET") &&
    currentUrl.pathname !== nextUrl.pathname &&
    dashboardTabFromLocation(currentUrl) &&
    dashboardTabFromLocation(nextUrl) &&
    !nextUrl.searchParams.has("plan_handle")
  ) {
    const currentParams = new URLSearchParams(currentUrl.search);
    const nextParams = new URLSearchParams(nextUrl.search);
    currentParams.delete("tab");
    nextParams.delete("tab");
    currentParams.sort();
    nextParams.sort();
    if (currentParams.toString() === nextParams.toString()) return false;
  }
  return defaultShouldRevalidate;
}
