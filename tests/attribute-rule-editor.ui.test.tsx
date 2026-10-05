import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { validateConfigurationInput } from "../app/services/configuration-validation";
import type { PublicConfiguration } from "../app/services/configuration.server";
import { AttributeRulesCard } from "../app/components/AttributeRulesCard";
const api = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }));
vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({ toast: { show: api.toast } }),
}));
vi.mock("../app/services/configuration-query", async (original) => ({
  ...(await original<typeof import("../app/services/configuration-query")>()),
  saveAttributeRulesRequest: api.save,
  attributeRuleStatusQueryOptions: () => ({
    queryKey: ["rule-status"],
    enabled: false,
  }),
}));
for (const kind of ["gender", "age"] as const) {
  it(`${kind} rule editor selects and enters tags in a collection-style popover and saves only on Save`, async () => {
    const configuration: PublicConfiguration = {
      ...validateConfigurationInput({
        alertsEmail: "test@example.com",
        countryCode: "US",
        colorOptions: [],
        sizeOptions: [],
      }),
      updatedAt: new Date().toISOString(),
      genderRulesVersion: 0,
      ageRulesVersion: 0,
      genderRulesAppliedVersion: 0,
      ageRulesAppliedVersion: 0,
      id: "config",
      defaultGender: null,
      defaultAgeGroup: null,
      genderRules: [
        {
          id: "legacy-gender",
          gender: "male",
          collections: [{ id: "gid://shopify/Collection/1", title: "Men" }],
          tags: [],
        },
      ],
      ageRules: [
        {
          id: "legacy-age",
          ageGroup: "adult",
          collections: [],
          tags: ["Existing"],
        },
      ],
    };
    api.save.mockReset();
    api.save.mockResolvedValue({
      feedRefreshRequired: true,
      configuration,
      ruleJobs: { gender: null, age: null },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            intent: "product-tags",
            productTags: ["mens", "adult"],
          }),
        ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <AttributeRulesCard
          configuration={configuration}
          initialJobs={{ age: null, gender: null }}
          scope={{ shop: "test.myshopify.com", sessionId: "test" }}
        />
      </QueryClientProvider>,
    );
    const editor = container.querySelector(`#${kind}-attribute-rules-modal`)!;
    (editor as HTMLElementTagNameMap["s-modal"]).hideOverlay = vi.fn();
    const tagPopover = editor.querySelector(
      `#attribute-rule-tags-${kind}-legacy-${kind}`,
    )!;
    const collectionPopover = editor.querySelector(
      `#attribute-rule-collections-${kind}-legacy-${kind}`,
    )!;
    expect(tagPopover.tagName).toBe("S-POPOVER");
    expect(tagPopover.getAttribute("inlinesize")).toBe(
      collectionPopover.getAttribute("inlinesize"),
    );
    expect(tagPopover.getAttribute("blocksize")).toBe(
      collectionPopover.getAttribute("blocksize"),
    );
    expect(editor.querySelector("s-modal")).toBeNull();
    expect(editor.textContent).toContain(
      kind === "gender"
        ? "This will set g:gender-field for products in specific collections or with a specific product tag."
        : "This will set g:age_group-field for products in specific collections or with a specific product tag.",
    );
    if (kind === "gender") {
      expect(editor.textContent).toContain(
        "Leave empty to not set any default value, otherwise select which gender to set in case no rules match.",
      );
    } else {
      expect(editor.textContent).toContain(
        "Leave empty to not set any default value, otherwise select which age group to set in case no rules match.",
      );
    }
    const divider = [...editor.querySelectorAll("div")].find(
      (element) => element.textContent === "OR",
    );
    expect(divider?.previousElementSibling?.textContent).toContain(
      "Collections",
    );
    expect(divider?.nextElementSibling?.textContent).toContain("Product Tags");
    const collectionPicker =
      divider!.previousElementSibling!.querySelector("s-clickable")!;
    expect(collectionPicker.previousElementSibling).toBeNull();
    if (kind === "gender") {
      expect(collectionPicker.nextElementSibling?.textContent).toContain("Men");
    } else {
      const tagField = divider?.nextElementSibling;
      expect(
        tagField?.querySelector("s-clickable")?.nextElementSibling?.textContent,
      ).toContain("Existing");
    }
    await act(async () => {
      tagPopover.dispatchEvent(new Event("show"));
    });
    await waitFor(() => expect(tagPopover.textContent).toContain("mens"));
    const buttons = () => [...tagPopover.querySelectorAll("s-button")];
    fireEvent.click(buttons().find((button) => button.textContent === "mens")!);
    const field = tagPopover.querySelector("s-search-field")!;
    Object.defineProperty(field, "value", {
      configurable: true,
      value: " custom-tag ",
    });
    fireEvent.input(field);
    fireEvent.submit(tagPopover.querySelector("form")!);
    Object.defineProperty(field, "value", {
      configurable: true,
      value: " MENS ",
    });
    fireEvent.input(field);
    fireEvent.click(
      buttons().find((button) => button.textContent === "Add tag")!,
    );
    expect(field.getAttribute("error")).toContain("already been added");
    const tagField = divider!.nextElementSibling!;
    const selectedTag = tagField.querySelector(
      'button[aria-label="Remove mens"]',
    )!;
    expect(selectedTag).toBeTruthy();
    fireEvent.click(selectedTag);
    await act(async () => {
      tagPopover.dispatchEvent(new Event("hide", { bubbles: true }));
    });
    await act(async () => {
      tagPopover.dispatchEvent(new Event("show"));
    });
    await waitFor(() => expect(tagPopover.textContent).toContain("mens"));
    fireEvent.click(buttons().find((button) => button.textContent === "mens")!);
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(
      [...editor.children].find(
        (element) =>
          element.tagName === "S-BUTTON" &&
          element.textContent?.trim() === "Save",
      )!,
    );
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    const saved = api.save.mock.calls[0]![1];
    expect(saved.rules[0].tags).toEqual(
      kind === "gender"
        ? ["custom-tag", "mens"]
        : ["Existing", "custom-tag", "mens"],
    );
    expect(saved.rules[0].collections).toEqual(
      configuration[kind === "gender" ? "genderRules" : "ageRules"][0]
        .collections,
    );
    client.clear();
  });
}
