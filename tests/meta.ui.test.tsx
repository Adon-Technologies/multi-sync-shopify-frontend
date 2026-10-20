import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  IntegrationsPanel,
  META_DISCONNECT_MODAL_ID,
} from "../app/components/IntegrationsPanel";
import { MetaConnectionSetup } from "../app/components/MetaConnectionSetup";
import type { MetaStatus } from "../app/services/meta-types";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({
    search: "?shop=mine.myshopify.com&host=encoded&embedded=1",
  }),
}));
const scope = { shop: "mine.myshopify.com", sessionId: "session" };
const active = {
  status: "CONNECTED_UNVERIFIED",
  accountName: "Facebook Person",
  accountId: "42",
  businessId: "11",
  businessName: "My Business",
  catalogId: "21",
  catalogName: "My Catalog",
  connectedAt: "2026-10-16T00:00:00Z",
  access: {
    catalogMetadataRead: "VERIFIED" as const,
    productWrite: "UNVERIFIED" as const,
  },
};
const pending = {
  id: "f".repeat(64),
  accountName: "Facebook Person",
  businessId: null,
  catalogId: null,
};
let status: MetaStatus;
let actions: Record<string, unknown>[];
let request: ReturnType<typeof vi.fn>;
let clients: QueryClient[];
let responseError: string | null;
let businesses: { id: string; name: string }[];
let catalogs: { id: string; name: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  clients = [];
  actions = [];
  responseError = null;
  businesses = [
    { id: "11", name: "My Business" },
    { id: "12", name: "Other Business" },
  ];
  catalogs = [
    { id: "21", name: "My Catalog" },
    { id: "23", name: "Shared Catalog" },
  ];
  status = {
    ok: true,
    connection: null,
    setup: null,
    error: null,
    code: null,
    oauthError: null,
  };
  request = vi.fn(async (_url: string, options: RequestInit) => {
    if (options.method === "GET") return Response.json(status);
    const input = JSON.parse(options.body as string);
    if (input.intent === "sync-status") return Response.json({ ok: true, enabled: false, run: null, lastSuccessfulSync: null });
    actions.push(input);
    if (responseError)
      return Response.json(
        { ok: false, error: responseError },
        { status: 403 },
      );
    if (input.intent === "start")
      return Response.json({
        ok: true,
        authorizationUrl:
          "https://backend.example/integrations/meta/authorize?state=random",
      });
    if (input.intent === "disconnect") status.connection = null;
    if (input.intent === "businesses")
      return Response.json({ ok: true, businesses });
    if (input.intent === "catalogs")
      return Response.json({ ok: true, catalogs });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  vi.unstubAllGlobals();
});
function panel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <IntegrationsPanel scope={scope} />
    </QueryClientProvider>,
  );
}
function select(label: string, value: string) {
  const element = document.querySelector(`s-select[label="${label}"]`)!;
  act(() => {
    Object.defineProperty(element, "value", {
      value,
      configurable: true,
      writable: true,
    });
    fireEvent.change(element);
  });
}

it("disconnected UI contains one integration, correct copy and no connection or sync controls", async () => {
  panel();
  await screen.findByText("Not connected");
  expect(screen.getByText("Connect with Facebook")).toBeTruthy();
  expect(
    document.querySelectorAll('s-section[heading="Facebook & Instagram"]'),
  ).toHaveLength(1);
  expect(screen.queryByText("Change Catalog")).toBeNull();
  expect(screen.queryByText("Disconnect")).toBeNull();
  expect(
    screen.queryByText(/Sync now|Automatic sync|Generate Meta feed/i),
  ).toBeNull();
});
it("starts a single real OAuth launch outside the iframe through _top", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  panel();
  const button = await screen.findByText("Connect with Facebook");
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() =>
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://backend.example/integrations/meta/authorize?state=random",
      "_top",
    ),
  );
  expect(actions).toEqual([{ intent: "start" }]);
});
it("missing configuration and cancelled login display actionable errors and never Connected", async () => {
  status.error = "Facebook connection is not configured.";
  status.oauthError = "OAUTH_CANCELLED";
  panel();
  await screen.findByText(status.error);
  expect(screen.getByText(/Facebook login was cancelled/)).toBeTruthy();
  expect(screen.queryByText("Connected")).toBeNull();
});
it("a pending login continues to a dedicated setup page while preserving embedded context", async () => {
  status.setup = pending;
  panel();
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/app/integrations/meta?shop=mine.myshopify.com&host=encoded&embedded=1",
      { replace: true },
    ),
  );
});
it.each([
  ["Change Account", "start", undefined],
  ["Change Business", "edit", "business"],
  ["Change Catalog", "edit", "catalog"],
])("%s starts the expected authorized change", async (label, intent, mode) => {
  status.connection = active;
  vi.spyOn(window, "open").mockReturnValue(null);
  panel();
  fireEvent.click(await screen.findByText(label!));
  await waitFor(() =>
    expect(actions).toEqual([{ intent, ...(mode ? { mode } : {}) }]),
  );
  if (intent === "edit")
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/app/integrations/meta?shop=mine.myshopify.com&host=encoded&embedded=1",
    );
});
it("saved connection shows verified read access and explicitly unverified writes; disconnect requires confirmation", async () => {
  status.connection = active;
  panel();
  await screen.findByText("Connected (write access unverified)");
  expect(screen.getByText(/Product write access is unverified/)).toBeTruthy();
  expect(screen.queryByText("Connected")).toBeNull();
  expect(screen.getByText("Facebook Account: Facebook Person")).toBeTruthy();
  expect(screen.getByText("Business Account: My Business (11)")).toBeTruthy();
  expect(screen.getByText("Product Catalog: My Catalog (21)")).toBeTruthy();
  const opener = screen
    .getAllByText("Disconnect")
    .find((node) => node.getAttribute("command") === "--show")!;
  expect(opener.getAttribute("commandfor")).toBe(META_DISCONNECT_MODAL_ID);
  fireEvent.click(opener);
  expect(actions).toHaveLength(0);
  const modal = document.getElementById(META_DISCONNECT_MODAL_ID)!;
  expect(modal.textContent).toContain(
    "products and Product Sets will remain in Meta",
  );
  fireEvent.click(modal.querySelector('[slot="primary-action"]')!);
  await screen.findByText("Not connected");
  expect(actions).toEqual([{ intent: "disconnect" }]);
});
it("expired authentication shows attention, not a false Connected badge", async () => {
  status.connection = { ...active, status: "NEEDS_ATTENTION" };
  status.error = "Facebook authentication has expired.";
  panel();
  await screen.findByText("Connection needs attention");
  expect(screen.queryByText("Connected")).toBeNull();
  expect(screen.getByText(status.error)).toBeTruthy();
});
it("setup lists authorized businesses and catalogs by ID, clears stale catalog on business change and validates confirmation", async () => {
  status.setup = pending;
  const done = vi.fn();
  render(<MetaConnectionSetup onDone={done} />);
  await screen.findByText("My Business (11)");
  select("Business Account", "11");
  await screen.findByText("Shared Catalog (23)");
  select("Product Catalog", "21");
  select("Business Account", "12");
  await waitFor(() =>
    expect(actions.filter((input) => input.intent === "catalogs")).toHaveLength(
      2,
    ),
  );
  expect(
    (
      document.querySelector(
        's-select[label="Product Catalog"]',
      ) as HTMLElementTagNameMap["s-select"]
    ).value,
  ).toBe("");
  select("Product Catalog", "23");
  fireEvent.click(screen.getByText("Connect Catalog"));
  fireEvent.click(screen.getByText("Connect Catalog"));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(actions.filter((input) => input.intent === "confirm")).toEqual([
    {
      intent: "confirm",
      attemptId: pending.id,
      businessId: "12",
      catalogId: "23",
    },
  ]);
});
it("empty business and catalog states include refresh and external catalog creation instructions", async () => {
  status.setup = pending;
  businesses = [];
  const first = render(<MetaConnectionSetup onDone={vi.fn()} />);
  await screen.findByText(/No Business Accounts are available/);
  expect(screen.getByText("Refresh list")).toBeTruthy();
  first.unmount();
  businesses = [{ id: "11", name: "My Business" }];
  catalogs = [];
  render(<MetaConnectionSetup onDone={vi.fn()} />);
  await screen.findByText("My Business (11)");
  select("Business Account", "11");
  await screen.findByText(/No ecommerce product catalogs/);
  const link = screen.getByText("Open Meta Commerce Manager");
  expect(link.getAttribute("href")).toBe(
    "https://business.facebook.com/commerce/",
  );
  expect(link.getAttribute("target")).toBe("_blank");
});
it("failed catalog read validation preserves setup and offers retry without marking Connected", async () => {
  status.setup = pending;
  const done = vi.fn();
  render(<MetaConnectionSetup onDone={done} />);
  await screen.findByText("My Business (11)");
  select("Business Account", "11");
  await screen.findByText("My Catalog (21)");
  select("Product Catalog", "21");
  responseError = "Meta did not grant catalog read access.";
  fireEvent.click(screen.getByText("Connect Catalog"));
  await screen.findByText(responseError);
  expect(done).not.toHaveBeenCalled();
  expect(screen.queryByText("Connected")).toBeNull();
});

it("never labels a legacy connection or an unverified read response as verified", async () => {
  status.connection = { ...active, status: "CONNECTED" };
  const first = panel();
  await screen.findByText("Connection needs attention");
  expect(screen.queryByText("Connected (write access unverified)")).toBeNull();
  first.unmount();
  status.connection = {
    ...active,
    access: { catalogMetadataRead: "UNVERIFIED", productWrite: "UNVERIFIED" },
  };
  panel();
  await screen.findByText("Connection needs attention");
  expect(screen.queryByText("Connected (write access unverified)")).toBeNull();
});

it("setup describes the read check and never promises verified write access", async () => {
  status.setup = pending;
  render(<MetaConnectionSetup onDone={vi.fn()} />);
  await screen.findByText("My Business (11)");
  select("Business Account", "11");
  await screen.findByText("My Catalog (21)");
  expect(
    screen.getByText(/Product write access will remain unverified/),
  ).toBeTruthy();
  expect(screen.queryByText(/will verify Manage catalog access/)).toBeNull();
});
it("cancelling setup removes only the pending attempt", async () => {
  status.setup = pending;
  const done = vi.fn();
  render(<MetaConnectionSetup onDone={done} />);
  await screen.findByText("My Business (11)");
  fireEvent.click(screen.getByText("Cancel"));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(actions.at(-1)).toMatchObject({
    intent: "cancel",
    attemptId: pending.id,
  });
});
