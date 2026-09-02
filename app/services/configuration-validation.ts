export interface SelectedCollection {
  id: string;
  title: string;
}

export const CHECKOUT_LINK_MODES = ["DISABLED", "CART", "CHECKOUT"] as const;

export type CheckoutLinkMode = (typeof CHECKOUT_LINK_MODES)[number];

export const INVENTORY_SOURCE_MODES = [
  "ALL_LOCATIONS",
  "SELECTED_LOCATIONS",
] as const;

export type InventorySourceMode = (typeof INVENTORY_SOURCE_MODES)[number];

export interface ConfigurationInput {
  alertsEmail: string;
  countryCode: string;
  colorOptions: string[];
  sizeOptions: string[];
  excludedCollections: SelectedCollection[];
  excludedTitleTerms: string[];
  productTypes: string[];
  showSalePriceInGoogleFeed: boolean;
  useProductImageAsMainImage: boolean;
  includeShippingWeightInGoogleFeed: boolean;
  excludeOutOfStockItems: boolean;
  ignoreShopifyInventoryInGoogleFeed: boolean;
  inventorySourceMode: InventorySourceMode;
  selectedInventoryLocationIds: string[];
  disableUtmParameters: boolean;
  disablePrimaryCurrencyParameter: boolean;
  checkoutLinkMode: CheckoutLinkMode;
}

export interface ConfigurationFieldErrors {
  alertsEmail?: string;
  countryCode?: string;
  colorOptions?: string;
  sizeOptions?: string;
  excludedCollections?: string;
  excludedTitleTerms?: string;
  productTypes?: string;
  showSalePriceInGoogleFeed?: string;
  useProductImageAsMainImage?: string;
  includeShippingWeightInGoogleFeed?: string;
  excludeOutOfStockItems?: string;
  ignoreShopifyInventoryInGoogleFeed?: string;
  inventorySourceMode?: string;
  selectedInventoryLocationIds?: string;
  disableUtmParameters?: string;
  disablePrimaryCurrencyParameter?: string;
  checkoutLinkMode?: string;
}

export class ConfigurationValidationError extends Error {
  readonly fields: ConfigurationFieldErrors;

  constructor(fields: ConfigurationFieldErrors) {
    super("Correct the highlighted configuration fields and try again.");
    this.name = "ConfigurationValidationError";
    this.fields = fields;
  }
}

const SHOPIFY_COLLECTION_ID = /^gid:\/\/shopify\/Collection\/\d+$/;
const SHOPIFY_LOCATION_ID = /^gid:\/\/shopify\/Location\/\d+$/;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_COLLECTIONS = 100;
const MAX_OPTION_NAMES = 100;
const MAX_OPTION_NAME_LENGTH = 100;
const MAX_TITLE_TERMS = 100;
const MAX_PRODUCT_TYPES = 100;
const MAX_PRODUCT_TYPE_LENGTH = 255;
const MAX_SELECTED_INVENTORY_LOCATIONS = 250;

export const DEFAULT_COLOR_OPTIONS: readonly string[] = [];
export const DEFAULT_SIZE_OPTIONS: readonly string[] = [];

export function normalizeConfigurationText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeOptionNames(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const name = normalizeConfigurationText(value).slice(
      0,
      MAX_OPTION_NAME_LENGTH,
    );
    const comparable = name.toLocaleLowerCase();

    if (!name || seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    names.push(name);
  }

  return names;
}

export function availableOptionNames(
  discoveredValues: unknown,
  selectedValues: unknown,
  unavailableValues: unknown,
) {
  const selected = normalizeOptionNames(selectedValues);
  const selectedKeys = new Set(
    selected.map((name) => name.toLocaleLowerCase()),
  );
  const unavailableKeys = new Set(
    normalizeOptionNames(unavailableValues).map((name) =>
      name.toLocaleLowerCase(),
    ),
  );

  return normalizeOptionNames([
    ...normalizeOptionNames(discoveredValues),
    ...selected,
  ]).filter((name) => {
    const comparable = name.toLocaleLowerCase();
    return selectedKeys.has(comparable) || !unavailableKeys.has(comparable);
  });
}

export function resolveStoredOptionNames(
  values: unknown,
  legacyValue: unknown,
  initialized: boolean,
  defaults: readonly string[],
) {
  const existing = normalizeOptionNames(values);

  if (initialized || existing.length > 0) {
    return existing;
  }

  const legacy = normalizeOptionNames(
    typeof legacyValue === "string" ? [legacyValue] : [],
  );

  return legacy.length > 0 ? legacy : normalizeOptionNames(defaults);
}

export function normalizeExcludedTitleTerms(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalizedTerms: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const term = normalizeConfigurationText(value).slice(0, 100);
    const comparable = term.toLocaleLowerCase();

    if (!term || seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    normalizedTerms.push(term);
  }

  return normalizedTerms;
}

export function normalizeProductTypes(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const productTypes: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const productType = normalizeConfigurationText(value).slice(
      0,
      MAX_PRODUCT_TYPE_LENGTH,
    );
    const comparable = productType.toLocaleLowerCase();

    if (!productType || seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    productTypes.push(productType);
  }

  return productTypes;
}

export function normalizeSelectedCollections(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const collections: SelectedCollection[] = [];

  for (const value of values) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof value.id !== "string" ||
      typeof value.title !== "string"
    ) {
      continue;
    }

    const id = value.id.trim();
    const title = normalizeConfigurationText(value.title).slice(0, 255);

    if (!SHOPIFY_COLLECTION_ID.test(id) || !title || seen.has(id)) {
      continue;
    }

    seen.add(id);
    collections.push({ id, title });
  }

  return collections;
}

export function normalizeCheckoutLinkMode(value: unknown): CheckoutLinkMode {
  return typeof value === "string" &&
    CHECKOUT_LINK_MODES.includes(value as CheckoutLinkMode)
    ? (value as CheckoutLinkMode)
    : "DISABLED";
}

export function normalizeInventorySourceMode(
  value: unknown,
): InventorySourceMode {
  return typeof value === "string" &&
    INVENTORY_SOURCE_MODES.includes(value as InventorySourceMode)
    ? (value as InventorySourceMode)
    : "ALL_LOCATIONS";
}

export function normalizeInventoryLocationIds(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!SHOPIFY_LOCATION_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function configurationRequiresFeedRefresh(
  previous: ConfigurationInput,
  next: ConfigurationInput,
) {
  return (
    JSON.stringify({ ...previous, productTypes: undefined }) !==
    JSON.stringify({ ...next, productTypes: undefined })
  );
}

export function validateConfigurationInput(value: unknown): ConfigurationInput {
  const fields: ConfigurationFieldErrors = {};
  const input: Record<string, unknown> =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const alertsEmail =
    typeof input.alertsEmail === "string"
      ? normalizeConfigurationText(input.alertsEmail).toLocaleLowerCase()
      : "";
  const countryCode =
    typeof input.countryCode === "string"
      ? normalizeConfigurationText(input.countryCode).toUpperCase()
      : "";
  const colorOptions = normalizeOptionNames(input.colorOptions);
  const sizeOptions = normalizeOptionNames(input.sizeOptions);
  const excludedCollections = normalizeSelectedCollections(
    input.excludedCollections,
  );
  const excludedTitleTerms = normalizeExcludedTitleTerms(
    input.excludedTitleTerms,
  );
  const productTypes = normalizeProductTypes(input.productTypes);
  const showSalePriceInGoogleFeed = input.showSalePriceInGoogleFeed === true;
  const useProductImageAsMainImage = input.useProductImageAsMainImage === true;
  const includeShippingWeightInGoogleFeed =
    input.includeShippingWeightInGoogleFeed === true;
  const excludeOutOfStockItems = input.excludeOutOfStockItems === true;
  const ignoreShopifyInventoryInGoogleFeed =
    input.ignoreShopifyInventoryInGoogleFeed === true;
  const inventorySourceMode = normalizeInventorySourceMode(
    input.inventorySourceMode,
  );
  const selectedInventoryLocationIds = normalizeInventoryLocationIds(
    input.selectedInventoryLocationIds,
  );
  const disableUtmParameters = input.disableUtmParameters === true;
  const disablePrimaryCurrencyParameter =
    input.disablePrimaryCurrencyParameter === true;
  const checkoutLinkMode = normalizeCheckoutLinkMode(input.checkoutLinkMode);

  if (!EMAIL_ADDRESS.test(alertsEmail) || alertsEmail.length > 254) {
    fields.alertsEmail = "Enter a valid email address.";
  }

  if (!/^[A-Z]{2}$/.test(countryCode)) {
    fields.countryCode = "Enter a two-letter country code.";
  }

  if (!Array.isArray(input.colorOptions)) {
    fields.colorOptions = "Select valid color option names.";
  } else if (input.colorOptions.length > MAX_OPTION_NAMES) {
    fields.colorOptions = `Select no more than ${MAX_OPTION_NAMES} color option names.`;
  } else if (
    input.colorOptions.some(
      (name) =>
        typeof name !== "string" ||
        !normalizeConfigurationText(name) ||
        normalizeConfigurationText(name).length > MAX_OPTION_NAME_LENGTH,
    )
  ) {
    fields.colorOptions = "Remove invalid color option names.";
  }

  if (!Array.isArray(input.sizeOptions)) {
    fields.sizeOptions = "Select valid size option names.";
  } else if (input.sizeOptions.length > MAX_OPTION_NAMES) {
    fields.sizeOptions = `Select no more than ${MAX_OPTION_NAMES} size option names.`;
  } else if (
    input.sizeOptions.some(
      (name) =>
        typeof name !== "string" ||
        !normalizeConfigurationText(name) ||
        normalizeConfigurationText(name).length > MAX_OPTION_NAME_LENGTH,
    )
  ) {
    fields.sizeOptions = "Remove invalid size option names.";
  }

  if (
    Array.isArray(input.excludedCollections) &&
    input.excludedCollections.length > MAX_COLLECTIONS
  ) {
    fields.excludedCollections = `Select no more than ${MAX_COLLECTIONS} collections.`;
  } else if (
    Array.isArray(input.excludedCollections) &&
    excludedCollections.length !== input.excludedCollections.length
  ) {
    fields.excludedCollections =
      "One or more selected collections are invalid.";
  }

  if (
    Array.isArray(input.excludedTitleTerms) &&
    input.excludedTitleTerms.length > MAX_TITLE_TERMS
  ) {
    fields.excludedTitleTerms = `Add no more than ${MAX_TITLE_TERMS} title terms.`;
  } else if (
    Array.isArray(input.excludedTitleTerms) &&
    input.excludedTitleTerms.some(
      (term) => typeof term !== "string" || !normalizeConfigurationText(term),
    )
  ) {
    fields.excludedTitleTerms = "Remove empty product-title terms.";
  }

  if (input.productTypes !== undefined && !Array.isArray(input.productTypes)) {
    fields.productTypes = "Add valid product types.";
  } else if (
    Array.isArray(input.productTypes) &&
    input.productTypes.length > MAX_PRODUCT_TYPES
  ) {
    fields.productTypes = `Add no more than ${MAX_PRODUCT_TYPES} product types.`;
  } else if (
    Array.isArray(input.productTypes) &&
    input.productTypes.some(
      (productType) =>
        typeof productType !== "string" ||
        !normalizeConfigurationText(productType) ||
        normalizeConfigurationText(productType).length >
          MAX_PRODUCT_TYPE_LENGTH,
    )
  ) {
    fields.productTypes = "Remove invalid product types.";
  }

  if (
    input.showSalePriceInGoogleFeed !== undefined &&
    typeof input.showSalePriceInGoogleFeed !== "boolean"
  ) {
    fields.showSalePriceInGoogleFeed =
      "Choose whether the Google feed should include sale prices.";
  }

  if (
    input.useProductImageAsMainImage !== undefined &&
    typeof input.useProductImageAsMainImage !== "boolean"
  ) {
    fields.useProductImageAsMainImage =
      "Choose which image should be used as the main feed image.";
  }

  if (
    input.includeShippingWeightInGoogleFeed !== undefined &&
    typeof input.includeShippingWeightInGoogleFeed !== "boolean"
  ) {
    fields.includeShippingWeightInGoogleFeed =
      "Choose whether the Google feed should include shipping weight.";
  }

  if (
    input.excludeOutOfStockItems !== undefined &&
    typeof input.excludeOutOfStockItems !== "boolean"
  ) {
    fields.excludeOutOfStockItems =
      "Choose whether out-of-stock variants should be excluded.";
  }

  if (
    input.ignoreShopifyInventoryInGoogleFeed !== undefined &&
    typeof input.ignoreShopifyInventoryInGoogleFeed !== "boolean"
  ) {
    fields.ignoreShopifyInventoryInGoogleFeed =
      "Choose whether Shopify inventory should be ignored.";
  }

  if (
    input.inventorySourceMode !== undefined &&
    (typeof input.inventorySourceMode !== "string" ||
      !INVENTORY_SOURCE_MODES.includes(
        input.inventorySourceMode as InventorySourceMode,
      ))
  ) {
    fields.inventorySourceMode = "Choose a valid inventory source.";
  }

  if (
    input.selectedInventoryLocationIds !== undefined &&
    !Array.isArray(input.selectedInventoryLocationIds)
  ) {
    fields.selectedInventoryLocationIds =
      "Select valid Shopify inventory locations.";
  } else if (
    Array.isArray(input.selectedInventoryLocationIds) &&
    input.selectedInventoryLocationIds.length > MAX_SELECTED_INVENTORY_LOCATIONS
  ) {
    fields.selectedInventoryLocationIds = `Select no more than ${MAX_SELECTED_INVENTORY_LOCATIONS} inventory locations.`;
  } else if (
    Array.isArray(input.selectedInventoryLocationIds) &&
    selectedInventoryLocationIds.length !==
      input.selectedInventoryLocationIds.length
  ) {
    fields.selectedInventoryLocationIds =
      "One or more selected inventory locations are invalid.";
  }

  if (
    input.disableUtmParameters !== undefined &&
    typeof input.disableUtmParameters !== "boolean"
  ) {
    fields.disableUtmParameters =
      "Choose whether product links should include UTM parameters.";
  }

  if (
    input.disablePrimaryCurrencyParameter !== undefined &&
    typeof input.disablePrimaryCurrencyParameter !== "boolean"
  ) {
    fields.disablePrimaryCurrencyParameter =
      "Choose whether the Primary feed should include its currency parameter.";
  }

  if (
    input.checkoutLinkMode !== undefined &&
    (typeof input.checkoutLinkMode !== "string" ||
      !CHECKOUT_LINK_MODES.includes(input.checkoutLinkMode as CheckoutLinkMode))
  ) {
    fields.checkoutLinkMode = "Choose a valid checkout link option.";
  }

  if (Object.keys(fields).length > 0) {
    throw new ConfigurationValidationError(fields);
  }

  return {
    alertsEmail,
    countryCode,
    colorOptions,
    sizeOptions,
    excludedCollections,
    excludedTitleTerms,
    productTypes,
    showSalePriceInGoogleFeed,
    useProductImageAsMainImage,
    includeShippingWeightInGoogleFeed,
    excludeOutOfStockItems,
    ignoreShopifyInventoryInGoogleFeed,
    inventorySourceMode,
    selectedInventoryLocationIds,
    disableUtmParameters,
    disablePrimaryCurrencyParameter,
    checkoutLinkMode,
  };
}
