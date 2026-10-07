import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { CollectionSelector } from "../app/components/ConfigurationsPanel";

vi.mock("@shopify/app-bridge-react", () => ({ SaveBar: () => null, useAppBridge: () => ({ toast: { show: vi.fn() } }) }));
const collections = [
  { id: "gid://shopify/Collection/1", title: "Summer", productsCount: { count: 124, precision: "EXACT" } },
  { id: "gid://shopify/Collection/2", title: "Shoes", productsCount: { count: 43, precision: "EXACT" } },
  { id: "gid://shopify/Collection/3", title: "Accessories", productsCount: { count: 19, precision: "EXACT" } },
];
vi.mock("../app/services/configuration-query", async (original) => ({
  ...await original<typeof import("../app/services/configuration-query")>(),
  collectionsQueryOptions: () => ({ queryKey: ["collections"], queryFn: async () => ({ collections, search: "", pageInfo: { hasNextPage: false } }) }),
}));

it("inclusion dialog displays counts and disabled excluded collections, confirms multiple selections and reopens to remove them", async () => {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { inclusion: true, scope: { shop: "test.myshopify.com", sessionId: "session" }, value: [], excludedIds: [collections[0].id], onChange };
  const wrapper = (value: typeof collections) => <QueryClientProvider client={client}><CollectionSelector {...props} value={value} /></QueryClientProvider>;
  const rendered = render(wrapper([]));
  const open = async () => {
    await act(async () => { rendered.container.querySelector("s-modal")!.dispatchEvent(new Event("show")); });
    await waitFor(() => expect(rendered.container.textContent).toContain("Summer (124 products)"));
  };
  await open();
  const buttons = () => [...rendered.container.querySelectorAll("s-button")];
  const excluded = buttons().find(button => button.textContent?.includes("Summer"))!;
  expect(excluded.hasAttribute("disabled")).toBe(true);
  expect(buttons().find(button => button.textContent?.includes("Shoes"))!.hasAttribute("disabled")).toBe(false);
  fireEvent.click(excluded);
  expect(rendered.container.textContent).toContain("Remove it from Exclude collection to select it here.");
  fireEvent.click(buttons().find(button => button.textContent?.includes("Shoes"))!);
  fireEvent.click(buttons().find(button => button.textContent?.includes("Accessories"))!);
  fireEvent.click(buttons().find(button => button.textContent?.includes("Confirm"))!);
  expect(onChange).toHaveBeenLastCalledWith([collections[1], collections[2]]);
  rendered.rerender(wrapper([collections[1], collections[2]]));
  await act(async () => { rendered.container.querySelector("s-modal")!.dispatchEvent(new Event("hide")); });
  await open();
  await act(async () => { rendered.container.querySelector("s-clickable-chip")!.dispatchEvent(new Event("remove")); });
  fireEvent.click(buttons().find(button => button.textContent?.includes("Confirm"))!);
  expect(onChange).toHaveBeenLastCalledWith([collections[2]]);
});

it("exclusion dialog keeps included collections visible but disabled while other collections remain selectable", async () => {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(<QueryClientProvider client={client}>
    <CollectionSelector scope={{ shop: "test.myshopify.com", sessionId: "session" }} value={[]}
      includedIds={[collections[0].id]} onChange={onChange} />
  </QueryClientProvider>);
  await act(async () => { rendered.container.querySelector("s-modal")!.dispatchEvent(new Event("show")); });
  await waitFor(() => expect(rendered.container.textContent).toContain("Remove it from the included collections to exclude it here."));
  const button = (text: string) => [...rendered.container.querySelectorAll("s-button")].find(entry => entry.textContent?.trim() === text)!;
  expect(button("Summer").hasAttribute("disabled")).toBe(true);
  expect(button("Shoes").hasAttribute("disabled")).toBe(false);
  fireEvent.click(button("Summer"));
  fireEvent.click(button("Shoes"));
  fireEvent.click(button("Confirm"));
  expect(onChange).toHaveBeenLastCalledWith([collections[1]]);
  client.clear();
});

it("exclusion dialog enables the collection again when inclusion is removed or All products is selected", async () => {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = (includedIds: string[]) => <QueryClientProvider client={client}>
    <CollectionSelector scope={{ shop: "test.myshopify.com", sessionId: "session" }} value={[]}
      includedIds={includedIds} onChange={onChange} />
  </QueryClientProvider>;
  const rendered = render(wrapper([collections[0].id]));
  await act(async () => { rendered.container.querySelector("s-modal")!.dispatchEvent(new Event("show")); });
  const button = (text: string) => [...rendered.container.querySelectorAll("s-button")].find(entry => entry.textContent?.trim() === text)!;
  await waitFor(() => expect(button("Summer")?.hasAttribute("disabled")).toBe(true));
  rendered.rerender(wrapper([]));
  expect(button("Summer").hasAttribute("disabled")).toBe(false);
  fireEvent.click(button("Summer"));
  fireEvent.click(button("Confirm"));
  expect(onChange).toHaveBeenLastCalledWith([collections[0]]);
  client.clear();
});
