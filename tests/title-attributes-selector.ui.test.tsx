import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { TitleAttributesSelector } from "../app/components/ConfigurationsPanel";

vi.mock("@shopify/app-bridge-react", () => ({
  SaveBar: () => null,
  useAppBridge: () => ({}),
}));


function setup(value: string[] = []) {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TitleAttributesSelector value={value} onChange={onChange} />
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

it("adds literal attributes with Enter, prevents duplicates, confirms and removes", async () => {
  const ui = setup();
  await ui.open();
  ui.type(" Blue ");
  fireEvent.submit(ui.modal.querySelector("form")!);
  ui.type("BLUE");
  fireEvent.submit(ui.modal.querySelector("form")!);
  expect(ui.modal.querySelectorAll("s-clickable-chip")).toHaveLength(1);
  ui.type("Kids (2-Pack)");
  fireEvent.submit(ui.modal.querySelector("form")!);
  fireEvent.click(ui.button("Confirm"));
  expect(ui.onChange).toHaveBeenLastCalledWith(["Blue", "Kids (2-Pack)"]);
  act(() => { ui.modal.querySelector("s-clickable-chip")!.dispatchEvent(new Event("remove")); });
  fireEvent.click(ui.button("Confirm"));
  expect(ui.onChange).toHaveBeenLastCalledWith(["Kids (2-Pack)"]);
  ui.client.clear();
});
