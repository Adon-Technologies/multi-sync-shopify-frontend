import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "../app/components/DiagnosticsPanel";
import type { DiagnosticsBulkEditJob } from "../app/services/diagnostics-bulk-edit";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  summaryReads: vi.fn(),
  pageReads: vi.fn(),
  refreshed: false,
}));
vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({ toast: { show: api.toast } }),
}));
vi.mock("../app/services/diagnostics-bulk-edit-query", () => ({
  diagnosticsBulkEditStatusQueryOptions: () => ({
    queryKey: ["bulk-status"],
    queryFn: async () => null,
    initialData: null,
    staleTime: Infinity,
  }),
  requestDiagnosticsBulkEdit: api.request,
}));
vi.mock("../app/services/diagnostics-query", async (original) => {
  const exports =
    await original<typeof import("../app/services/diagnostics-query")>();
  const counts = {
    allProducts: 1500,
    submitted: 1500,
    warnings: 0,
    excluded: 0,
    hasSnapshot: true,
    scanVersion: "scan",
    configurationRevision: "rev",
    generatedAt: "now",
  };
  const page = {
    scanVersion: "scan",
    totalProducts: 1500,
    pageInfo: {
      hasNextPage: true,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: "end",
    },
    products: [1, 2, 3].map((id) => ({
      id: `gid://shopify/Product/${id}`,
      title: `Product ${id}`,
      createdAt: "now",
      categoryName: "Shoes",
      productType: "Shoes",
      status: "submitted",
      warnings: [],
      tags: [],
      vendor: null,
      imageUrl: null,
      imageAlt: null,
      genderValues: [],
      ageValues: [],
      colorValues: [],
      sizeValues: [],
      customLabel0Values: [],
      customLabel1Values: [],
      customLabel2Values: [],
      customLabel3Values: [],
      customLabel4Values: [],
    })),
  };
  return {
    ...exports,
    diagnosticsSummaryQueryOptions: (
      scope: { shop: string; sessionId: string },
      generation: number,
      options: { force?: boolean } = {},
    ) => ({
      queryKey: [
        "diagnostics",
        scope.shop,
        scope.sessionId,
        generation,
        "summary",
      ],
      queryFn: async () => {
        api.summaryReads(options);
        if (options.force) api.refreshed = true;
        return counts;
      },
      initialData: generation === 0 ? counts : undefined,
      staleTime: options.force ? 0 : Infinity,
    }),
    diagnosticsProductsQueryOptions: (
      scope: { shop: string; sessionId: string },
      generation: number,
    ) => ({
      queryKey: [
        "diagnostics",
        scope.shop,
        scope.sessionId,
        generation,
        "page",
      ],
      queryFn: async () => {
        api.pageReads();
        return api.refreshed
          ? {
              ...page,
              products: page.products.map((product) => ({
                ...product,
                title: `Refreshed ${product.title}`,
              })),
            }
          : page;
      },
      initialData: generation === 0 ? page : undefined,
      staleTime: Infinity,
    }),
  };
});
const scope = { shop: "test.myshopify.com", sessionId: "session" };
function job(
  kind = "gender",
  value = "male",
  count = 3,
): DiagnosticsBulkEditJob {
  return {
    id: "job",
    edit: { kind, value } as DiagnosticsBulkEditJob["edit"],
    createdAt: "now",
    completedAt: null,
    startedAt: null,
    errorSamples: [],
    failedCount: 0,
    processedCount: 0,
    successfulCount: 0,
    requestedCount: count,
    status: "QUEUED",
  };
}
beforeEach(() => {
  api.request.mockReset();
  api.toast.mockReset();
  api.summaryReads.mockReset();
  api.pageReads.mockReset();
  api.refreshed = false;
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <DiagnosticsPanel active scope={scope} />
    </QueryClientProvider>,
  );
  for (const overlay of rendered.container.querySelectorAll("s-modal")) {
    Object.assign(overlay, { showOverlay: vi.fn(), hideOverlay: vi.fn() });
  }
  const buttons = () => [...rendered.container.querySelectorAll("s-button")];
  const button = (text: string) =>
    buttons().find((element) => element.textContent?.trim() === text)!;
  const selectPage = () => {
    const checkbox = rendered.container.querySelector(
      's-checkbox[accessibilitylabel="Select all products on this page"]',
    )!;
    Object.defineProperty(checkbox, "checked", {
      configurable: true,
      value: true,
    });
    fireEvent.change(checkbox);
  };
  const modal = rendered.container.querySelector(
    "#diagnostics-bulk-edit-modal",
  )!;
  const apply = modal.querySelector('s-button[slot="primary-action"]')!;
  return { ...rendered, client, button, selectPage, modal, apply };
}
function choose(modal: Element, value: string) {
  const trigger = modal.querySelector(
    's-clickable[commandfor="diagnostics-bulk-attribute-values"]',
  )!;
  fireEvent.click(trigger);
  const option = [
    ...modal.querySelectorAll("#diagnostics-bulk-attribute-values s-button"),
  ].find((button) => button.textContent?.trim() === value)!;
  fireEvent.click(option);
}
for (const [kind, title, values] of [
  ["gender", "Gender", ["male", "female", "unisex"]],
  ["ageGroup", "Age Group", ["adult", "infant", "kids", "toddler", "newborn"]],
] as const) {
  it(`${title} bulk edit shows no banners and preserves the normal results until an explicit refresh`, async () => {
    const ui = setup();
    const invalidations = vi.spyOn(ui.client, "invalidateQueries");
    ui.selectPage();
    fireEvent.click(ui.button(`Assign ${title}`));
    expect(ui.modal.getAttribute("heading")).toBe(`Assign ${title}`);
    const trigger = ui.modal.querySelector(
      's-clickable[commandfor="diagnostics-bulk-attribute-values"]',
    )!;
    expect(trigger.getAttribute("accessibilitylabel")).toBe(
      `Choose Product ${title}`,
    );
    expect(trigger.getAttribute("command")).toBe("--show");
    expect(ui.modal.querySelector("s-select, select")).toBeNull();
    expect(
      [
        ...ui.modal.querySelectorAll(
          "#diagnostics-bulk-attribute-values s-button",
        ),
      ].map((option) => option.textContent?.trim()),
    ).toEqual(values);
    expect(
      ui.modal
        .querySelector("#diagnostics-bulk-attribute-values s-button")
        ?.getAttribute("command"),
    ).toBe("--hide");
    expect(ui.modal.querySelector("s-banner")).toBeNull();
    expect(ui.modal.textContent).not.toContain("Empty values clear");
    expect(ui.apply.getAttribute("disabled")).toBe("true");
    choose(ui.modal, values[0]);
    expect(trigger.textContent).toBe(values[0]);
    expect(
      ui.modal.querySelector(
        '#diagnostics-bulk-attribute-values s-button s-icon[type="check"]',
      ),
    ).toBeTruthy();
    expect(ui.apply.getAttribute("disabled")).toBe("false");
    const queued = job(kind, values[0]);
    api.request.mockResolvedValue(queued);
    fireEvent.click(ui.apply);
    await waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    expect(api.request.mock.calls[0][0]).toMatchObject({
      edit: { kind, value: values[0] },
      selection: {
        mode: "explicit",
        productIds: [
          "gid://shopify/Product/1",
          "gid://shopify/Product/2",
          "gid://shopify/Product/3",
        ],
      },
    });
    await waitFor(() =>
      expect(api.toast).toHaveBeenCalledWith(`${title} is being added.`),
    );
    await act(async () => {
      ui.client.setQueryData(["bulk-status"], {
        ...queued,
        status: "PROCESSING",
        processedCount: 1,
      });
    });
    await waitFor(() => expect(trigger.getAttribute("disabled")).toBe("true"));
    expect(ui.container.querySelector("s-banner")).toBeNull();
    expect(ui.container.textContent).toContain("Product 1");
    await act(async () => {
      ui.client.setQueryData(["bulk-status"], {
        ...queued,
        status: "COMPLETED",
        successfulCount: 3,
        processedCount: 3,
      });
    });
    await waitFor(() =>
      expect(api.toast).toHaveBeenCalledWith(
        `${title} added to 3 products. Refresh feeds to include these changes.`,
      ),
    );
    expect(ui.container.textContent).not.toContain("3 products selected");
    expect(ui.container.querySelector("s-banner")).toBeNull();
    expect(ui.container.textContent).toContain(
      "Showing 1 to 3 of 1,500 Products",
    );
    expect(ui.container.textContent).toContain("Product 1");
    expect(
      invalidations.mock.calls.some(
        ([filters]) => filters?.queryKey?.[0] === "diagnostics",
      ),
    ).toBe(false);
    expect(api.summaryReads).not.toHaveBeenCalled();
    expect(api.pageReads).not.toHaveBeenCalled();
    fireEvent.click(ui.button("Refresh Product Errors"));
    await waitFor(() =>
      expect(api.summaryReads).toHaveBeenCalledWith(
        expect.objectContaining({ force: true }),
      ),
    );
    await waitFor(() =>
      expect(ui.container.textContent).toContain("Refreshed Product 1"),
    );
    ui.client.clear();
  });
  it(`${title} Select all queues the complete catalog and partial failures show accurate feedback`, async () => {
    const ui = setup();
    ui.selectPage();
    fireEvent.click(ui.button("Select all products"));
    fireEvent.click(ui.button(`Assign ${title}`));
    choose(ui.modal, values[0]);
    const queued = job(kind, values[0], 1500);
    api.request.mockResolvedValue(queued);
    fireEvent.click(ui.apply);
    await waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    expect(api.request.mock.calls[0][0].selection).toEqual({
      mode: "allMatching",
      excludedProductIds: [],
    });
    expect(api.request.mock.calls[0][0].scope.snapshotVersion).toBe("scan");
    await waitFor(() =>
      expect(api.toast).toHaveBeenCalledWith(`${title} is being added.`),
    );
    await act(async () => {
      ui.client.setQueryData(["bulk-status"], {
        ...queued,
        status: "PARTIALLY_COMPLETED",
        successfulCount: 1499,
        failedCount: 1,
        errorSamples: ["Product deleted"],
      });
    });
    await waitFor(() =>
      expect(api.toast).toHaveBeenCalledWith(
        "1,499 products updated. 1 products could not be updated. Product deleted",
        { isError: true },
      ),
    );
    expect(ui.container.querySelector("s-banner")).toBeNull();
    expect(ui.container.textContent).toContain(
      "Showing 1 to 3 of 1,500 Products",
    );
    expect(api.summaryReads).not.toHaveBeenCalled();
    expect(api.pageReads).not.toHaveBeenCalled();
    expect(
      api.toast.mock.calls.some(([text]) =>
        String(text).includes("added to 1,500"),
      ),
    ).toBe(false);
    ui.client.clear();
  });
}
it("pending submission locks Apply and uses one stable request identifier on a network retry", async () => {
  const ui = setup();
  ui.selectPage();
  fireEvent.click(ui.button("Assign Gender"));
  choose(ui.modal, "female");
  let reject!: (error: Error) => void;
  api.request.mockReturnValueOnce(
    new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise;
    }),
  );
  fireEvent.click(ui.apply);
  fireEvent.click(ui.apply);
  await waitFor(() => expect(api.request).toHaveBeenCalledOnce());
  expect(ui.apply.getAttribute("loading")).toBe("true");
  const first = api.request.mock.calls[0][0];
  await act(async () => {
    reject(new Error("Network unavailable"));
  });
  await waitFor(() =>
    expect(ui.modal.textContent).toContain("Network unavailable"),
  );
  api.request.mockResolvedValue(job("gender", "female"));
  fireEvent.click(ui.apply);
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
  expect(api.request.mock.calls[1][0].idempotencyKey).toBe(
    first.idempotencyKey,
  );
  ui.client.clear();
});
it("single-product selection and a failed job preserve the selection and show its error", async () => {
  const ui = setup();
  const checkbox = ui.container.querySelector(
    's-checkbox[accessibilitylabel="Select Product 1"]',
  )!;
  Object.defineProperty(checkbox, "checked", {
    configurable: true,
    value: true,
  });
  fireEvent.change(checkbox);
  fireEvent.click(ui.button("Assign Age Group"));
  choose(ui.modal, "newborn");
  const queued = job("ageGroup", "newborn", 1);
  api.request.mockResolvedValue(queued);
  fireEvent.click(ui.apply);
  await waitFor(() => expect(api.request).toHaveBeenCalledOnce());
  expect(api.request.mock.calls[0][0].selection.productIds).toEqual([
    "gid://shopify/Product/1",
  ]);
  await waitFor(() =>
    expect(api.toast).toHaveBeenCalledWith("Age Group is being added."),
  );
  await act(async () => {
    ui.client.setQueryData(["bulk-status"], {
      ...queued,
      status: "FAILED",
      failedCount: 1,
      errorSamples: ["Shopify access expired"],
    });
  });
  await waitFor(() =>
    expect(api.toast).toHaveBeenCalledWith("Shopify access expired", {
      isError: true,
    }),
  );
  expect(ui.container.textContent).toContain("1 product selected");
  ui.client.clear();
});
