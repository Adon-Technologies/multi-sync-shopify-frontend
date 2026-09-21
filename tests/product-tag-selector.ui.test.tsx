import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ProductTagsSelector } from "../app/components/ConfigurationsPanel";

vi.mock("@shopify/app-bridge-react", () => ({
  SaveBar: () => null,
  useAppBridge: () => ({}),
}));
const scope = { shop: "shop.myshopify.com", sessionId: "session" };

function setup(value: string[] = []) {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProductTagsSelector scope={scope} value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  const modal = view.container.querySelector("s-modal")!;
  const button = (text: string) =>
    [...modal.querySelectorAll("s-button")].find(
      (node) => node.textContent === text,
    )!;
  const type = (text: string) => {
    const field = modal.querySelector("s-text-field")!;
    Object.defineProperty(field, "value", { configurable: true, value: text });
    fireEvent.input(field);
  };
  const open = async () =>
    act(async () => {
      modal.dispatchEvent(new Event("show"));
    });
  return { ...view, modal, button, type, open, onChange, client };
}

it("loads Shopify tags on opening, selects and adds multiple tags, rejects duplicates and removes tags", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        intent: "product-tags",
        productTags: ["Summer", "Clearance", "VIP"],
      }),
    ),
  );
  const ui = setup();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    ui.container.querySelector("s-clickable")?.getAttribute("commandfor"),
  ).toBe(ui.modal.id);
  await ui.open();
  await waitFor(() => expect(ui.button("Clearance")).toBeTruthy());
  fireEvent.click(ui.button("Clearance"));
  ui.type(" clearance ");
  fireEvent.click(ui.button("Add"));
  expect(
    ui.modal.querySelector("s-text-field")?.getAttribute("error"),
  ).toContain("already been added");
  ui.type(" google-exclude ");
  fireEvent.submit(ui.modal.querySelector("form")!);
  expect(ui.modal.querySelectorAll("s-clickable-chip")).toHaveLength(2);
  ui.type("VIP");
  expect(ui.button("Summer")).toBeUndefined();
  fireEvent.click(ui.button("VIP"));
  act(() => {
    ui.modal
      .querySelector("s-clickable-chip")!
      .dispatchEvent(new Event("remove"));
  });
  fireEvent.click(ui.button("Confirm"));
  expect(ui.onChange).toHaveBeenCalledWith(["google-exclude", "VIP"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  ui.client.clear();
});

it("keeps manual entry available during loading and on Shopify failure; Cancel restores saved tags", async () => {
  let fail!: (reason: Error) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const ui = setup(["Existing"]);
  await ui.open();
  expect(ui.modal.querySelector("s-spinner")).toBeTruthy();
  ui.type("Pending");
  fireEvent.click(ui.button("Add"));
  await act(async () => {
    fail(new Error("Shopify unavailable"));
  });
  await waitFor(() =>
    expect(ui.modal.textContent).toContain("could not be loaded"),
  );
  ui.type(" custom ");
  fireEvent.click(ui.button("Add"));
  fireEvent.click(ui.button("Confirm"));
  expect(ui.onChange).toHaveBeenLastCalledWith([
    "Existing",
    "Pending",
    "custom",
  ]);
  await act(async () => {
    ui.modal.dispatchEvent(new Event("hide"));
  });
  await ui.open();
  expect(ui.modal.querySelectorAll("s-clickable-chip")).toHaveLength(1);
  ui.type("Discard");
  fireEvent.click(ui.button("Add"));
  fireEvent.click(ui.button("Cancel"));
  expect(ui.onChange).toHaveBeenCalledTimes(1);
  ui.client.clear();
});

it("shows empty and no-match states and accepts custom tags", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ ok: true, intent: "product-tags", productTags: [] }),
    ),
  );
  const ui = setup();
  await ui.open();
  await waitFor(() =>
    expect(ui.modal.textContent).toContain("No Shopify tags available"),
  );
  ui.type("google-exclude");
  expect(ui.modal.textContent).toContain("No matching Shopify tags");
  fireEvent.click(ui.button("Add"));
  fireEvent.click(ui.button("Confirm"));
  expect(ui.onChange).toHaveBeenCalledWith(["google-exclude"]);
  ui.client.clear();
});

it("limits rendered suggestions while searching every fetched tag", async () => {
  const productTags = Array.from({ length: 125 }, (_, index) => `Tag ${index}`);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ ok: true, intent: "product-tags", productTags }),
    ),
  );
  const ui = setup();
  await ui.open();
  await waitFor(() => expect(ui.button("Tag 49")).toBeTruthy());
  expect(ui.button("Tag 50")).toBeUndefined();
  fireEvent.click(ui.button("Show more tags"));
  expect(ui.button("Tag 99")).toBeTruthy();
  ui.type("Tag 124");
  expect(ui.button("Tag 124")).toBeTruthy();
  fireEvent.click(ui.button("Tag 124"));
  fireEvent.click(ui.button("Confirm"));
  expect(ui.onChange).toHaveBeenCalledWith(["Tag 124"]);
  ui.client.clear();
});
