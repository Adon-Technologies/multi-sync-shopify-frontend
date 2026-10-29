import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MetaSyncPanel,
  type MetaSyncStatus,
} from "../app/components/MetaSyncPanel";
import { FacebookStatus } from "../app/components/MetaDiagnostics";

let client: QueryClient;
let state: MetaSyncStatus;
let writes: Record<string, unknown>[];
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  writes = [];
  state = {
    enabled: true,
    automaticSyncEnabled: true,
    run: null,
    lastSuccessfulSync: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (["sync-start", "sync-enable"].includes(body.intent)) {
        writes.push(body);
        if (body.intent === "sync-enable") {
          state.automaticSyncEnabled = true;
          state.nextAutomaticSyncAt = "2030-05-10T00:00:00.000Z";
          return Response.json({ ok: true });
        }
        state.run = {
          id: "run",
          status: "PREPARING",
          active: true,
          enumerationComplete: false,
          total: 0,
          processed: 0,
          succeeded: 0,
          failed: 0,
          excluded: 0,
          staleItems: 0,
          error: null,
        };
        return Response.json({ ok: true, runId: "run" });
      }
      return Response.json({ ok: true, ...state });
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
function panel() {
  return render(
    <QueryClientProvider client={client}>
      <MetaSyncPanel
        scope={{ shop: "mine.myshopify.com", sessionId: "staff" }}
        catalogId="21"
        catalogName="Multi Sync Test Catalog"
        onCompleted={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
it("requires confirmation, explains the target, and prevents duplicate starts", async () => {
  panel();
  const opener = await screen.findByText("Sync now");
  await waitFor(() => expect(opener.getAttribute("disabled")).toBeNull());
  fireEvent.click(screen.getByText("Sync now"));
  expect(writes).toHaveLength(0);
  const modal = document.getElementById("meta-sync-confirmation")!;
  expect(modal.textContent).toContain("Multi Sync Test Catalog");
  expect(modal.textContent).toContain("Shopify products will not be edited");
  const confirm = screen.getByText("Start synchronization");
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByText("Preparing");
  expect(writes).toEqual([{ intent: "sync-start", confirmed: true }]);
  expect(screen.getByText("Sync now").getAttribute("disabled")).toBe("true");
});
it("existing connections require one clear confirmation to enable automatic full synchronization", async () => {
  state.automaticSyncEnabled = false;
  panel();
  const opener = await screen.findByText("Enable automatic sync");
  await waitFor(() => expect(opener.getAttribute("disabled")).toBeNull());
  expect(writes).toHaveLength(0);
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(opener);
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByText("Enable daily sync"));
  await waitFor(() =>
    expect(writes).toEqual([{ intent: "sync-enable", confirmed: true }]),
  );
  await screen.findByText(/Next scheduled sync: 2030-05-10 00:00:00 UTC/);
  expect(screen.queryByText("Preparing")).toBeNull();
  expect(screen.getByText("Sync now").getAttribute("disabled")).toBeNull();
});
it("explains the midnight UTC schedule while leaving manual sync available before then", async () => {
  state.nextAutomaticSyncAt = "2030-05-10T00:00:00.000Z";
  panel();
  await screen.findByText(/^Automatic sync runs once daily at 00:00 UTC/);
  expect(screen.getByText(/Next scheduled sync:/).textContent).toContain(
    "2030-05-10 00:00:00 UTC",
  );
  expect(screen.queryByText(/synchronized after changes/)).toBeNull();
  expect(screen.getByText("Sync now").getAttribute("disabled")).toBeNull();
  expect(writes).toHaveLength(0);
});
it("empty runs never claim a successful sync", async () => {
  state.run = {
    id: "empty",
    status: "NO_ELIGIBLE_PRODUCTS",
    active: false,
    enumerationComplete: true,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    excluded: 1319,
    staleItems: 0,
    error: "No eligible variants were submitted to Meta.",
  };
  panel();
  const badge = await screen.findByText("Nothing submitted");
  expect(badge.getAttribute("tone")).toBe("warning");
  expect(screen.getByText(/Last successful sync:/).textContent).toContain(
    "Never",
  );
});
it("restores persistent progress and never calls acceptance successful", async () => {
  state.run = {
    id: "saved",
    status: "PROCESSING",
    active: true,
    enumerationComplete: true,
    total: 10,
    processed: 2,
    succeeded: 1,
    failed: 1,
    excluded: 3,
    staleItems: 0,
    error: null,
  };
  panel();
  await screen.findByText("Processing in Meta");
  expect(screen.getByText(/Synchronized: 1/)).toBeTruthy();
  expect(screen.getByText(/continues in the background/)).toBeTruthy();
  expect(writes).toHaveLength(0);
});
it("completed product-link warnings stay visible and never imply public accessibility was verified", async () => {
  state.run = {
    id: "warnings",
    status: "COMPLETED_WITH_WARNINGS",
    active: false,
    enumerationComplete: true,
    total: 7,
    processed: 7,
    succeeded: 7,
    warnings: 7,
    failed: 0,
    excluded: 0,
    staleItems: 0,
    error: null,
  };
  panel();
  expect(
    (await screen.findByText("Completed with warnings")).getAttribute("tone"),
  ).toBe("warning");
  expect(
    screen.getByText(/does not confirm public storefront access/),
  ).toBeTruthy();
});
it("disabled sync setup never authorizes a write", async () => {
  state.enabled = false;
  panel();
  await screen.findByText(/synchronization is disabled/);
  expect(screen.getByText("Sync now").getAttribute("disabled")).toBe("true");
  expect(writes).toHaveLength(0);
});
it("terminal errors and removal requirements are visible", async () => {
  state.run = {
    id: "finished",
    status: "COMPLETED_WITH_ERRORS",
    active: false,
    enumerationComplete: true,
    total: 10,
    processed: 10,
    succeeded: 9,
    failed: 1,
    excluded: 0,
    staleItems: 2,
    error: "Review rejected variants.",
  };
  panel();
  await screen.findByText("Completed with errors");
  expect(screen.getByText(/2 previously managed items/)).toBeTruthy();
  expect(screen.getByText("Review rejected variants.")).toBeTruthy();
});
it.each([
  "Pending",
  "Synchronizing",
  "Error",
  "Not synced",
  "Not connected",
  "Excluded",
  "Submitted with warnings",
])("Facebook %s is never rendered as a green Submitted badge", (status) => {
  const result = render(
    <FacebookStatus
      value={{ status, counts: { SUBMITTED: 1, PENDING: 1 } }}
      failed={false}
    />,
  );
  expect(
    result.container.querySelector("s-badge")!.getAttribute("tone"),
  ).not.toBe("success");
});
it("only confirmed aggregate Submitted is green, and status retrieval errors remain explicit", async () => {
  const result = render(
    <FacebookStatus
      value={{ status: "Submitted", counts: { SUBMITTED: 2 } }}
      failed={false}
    />,
  );
  expect(result.container.querySelector("s-badge")!.getAttribute("tone")).toBe(
    "success",
  );
  result.rerender(
    <FacebookStatus value={{ status: "Submitted", counts: {} }} failed />,
  );
  await waitFor(() =>
    expect(screen.getByText("Status unavailable")).toBeTruthy(),
  );
  expect(result.container.querySelector("s-badge")!.getAttribute("tone")).toBe(
    "neutral",
  );
});
