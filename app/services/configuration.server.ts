import type {
  AttributeRuleJob,
  AttributeRuleKind,
  Prisma,
} from "@prisma/client";

import prisma from "../db.server";
import { ensureAttributeRuleConfigurationFields } from "./attribute-rule-schema.server";
import {
  AttributeRulesValidationError,
  hasAttributeRuleProductAccess,
  parseStoredAgeRules,
  parseStoredGenderRules,
  validateAgeRules,
  validateGenderRules,
  type AgeRulesConfiguration,
  type AttributeRuleKind as PublicAttributeRuleKind,
  type GenderRulesConfiguration,
} from "./attribute-rules";
import {
  CollectionVerificationError,
  verifyShopCollections,
} from "./collection-search.server";
import { createDiagnosticsConfigurationRevision } from "./configuration-revision.server";
import {
  DEFAULT_COLOR_OPTIONS,
  DEFAULT_SIZE_OPTIONS,
  normalizeOptionNames,
  normalizeSelectedCollections,
  normalizeCheckoutLinkMode,
  normalizeInventoryLocationIds,
  normalizeInventorySourceMode,
  resolveStoredOptionNames,
  type ConfigurationInput,
  type SelectedCollection,
  validateConfigurationInput,
} from "./configuration-validation";
import { verifySelectedInventoryLocations } from "./shopify-locations.server";
import {
  queryShopifyAdmin,
  type AdminGraphQLClient,
} from "./shopify-admin.server";
import { normalizeShopDomain } from "./store-lifecycle";
import { upsertInstalledStore } from "./store.server";

const CONFIGURATION_BOOTSTRAP_QUERY = `#graphql
  query ConfigurationBootstrap {
    shop {
      contactEmail
      email
      billingAddress {
        countryCodeV2
      }
    }
  }
`;

interface ConfigurationBootstrapQuery {
  shop: {
    contactEmail: string | null;
    email: string;
    billingAddress: {
      countryCodeV2: string | null;
    };
  };
}

interface StoredConfiguration {
  ageRules: Prisma.JsonValue | null;
  ageRulesAppliedVersion: number;
  ageRulesVersion: number;
  alertsEmail: string;
  colorOption: string | null;
  colorOptions: string[];
  countryCode: string;
  createdAt: Date;
  defaultAgeGroup: string | null;
  defaultGender: string | null;
  diagnosticsRevision: string;
  excludedCollections: Prisma.JsonValue;
  excludedTitleTerms: string[];
  genderRules: Prisma.JsonValue | null;
  genderRulesAppliedVersion: number;
  genderRulesVersion: number;
  id: string;
  optionMappingsInitialized: boolean;
  showSalePriceInGoogleFeed: boolean;
  useProductImageAsMainImage: boolean;
  includeShippingWeightInGoogleFeed: boolean;
  excludeOutOfStockItems: boolean;
  ignoreShopifyInventoryInGoogleFeed: boolean;
  inventorySourceMode: "ALL_LOCATIONS" | "SELECTED_LOCATIONS";
  selectedInventoryLocationIds: string[];
  disableUtmParameters: boolean;
  disablePrimaryCurrencyParameter: boolean;
  checkoutLinkMode: "DISABLED" | "CART" | "CHECKOUT";
  sizeOption: string | null;
  sizeOptions: string[];
  storeId: string;
  updatedAt: Date;
}

export interface PublicConfiguration extends ConfigurationInput {
  ageRules: AgeRulesConfiguration["rules"];
  ageRulesAppliedVersion: number;
  ageRulesVersion: number;
  defaultAgeGroup: AgeRulesConfiguration["defaultAgeGroup"];
  defaultGender: GenderRulesConfiguration["defaultGender"];
  genderRules: GenderRulesConfiguration["rules"];
  genderRulesAppliedVersion: number;
  genderRulesVersion: number;
  id: string;
  updatedAt: string;
}

export interface PublicAttributeRuleJob {
  generationCompletedAt: string | null;
  generationStartedAt: string | null;
  kind: PublicAttributeRuleKind;
  lastError: string | null;
  processedProducts: number;
  ruleVersion: number;
  status: "IDLE" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalProducts: number | null;
}

export interface PublicAttributeRuleJobs {
  age: PublicAttributeRuleJob | null;
  gender: PublicAttributeRuleJob | null;
}

export class AttributeRuleScopeError extends Error {
  constructor() {
    super(
      "Gender and Age rules require the write_products Shopify scope. Deploy the updated app scopes and reauthorize the store.",
    );
    this.name = "AttributeRuleScopeError";
  }
}

export interface DiagnosticsConfigurationRules {
  colorOptions: string[];
  excludedCollections: SelectedCollection[];
  excludedTitleTerms: string[];
  revision: string;
  sizeOptions: string[];
}

function mapConfiguration(
  configuration: StoredConfiguration,
): PublicConfiguration {
  const gender = parseStoredGenderRules(
    configuration.defaultGender,
    configuration.genderRules,
  );
  const age = parseStoredAgeRules(
    configuration.defaultAgeGroup,
    configuration.ageRules,
  );

  return {
    id: configuration.id,
    ageRules: age.rules,
    ageRulesAppliedVersion: configuration.ageRulesAppliedVersion,
    ageRulesVersion: configuration.ageRulesVersion,
    alertsEmail: configuration.alertsEmail,
    countryCode: configuration.countryCode,
    defaultAgeGroup: age.defaultAgeGroup,
    defaultGender: gender.defaultGender,
    colorOptions: normalizeOptionNames(configuration.colorOptions),
    sizeOptions: normalizeOptionNames(configuration.sizeOptions),
    excludedCollections: normalizeSelectedCollections(
      configuration.excludedCollections,
    ),
    excludedTitleTerms: configuration.excludedTitleTerms,
    genderRules: gender.rules,
    genderRulesAppliedVersion: configuration.genderRulesAppliedVersion,
    genderRulesVersion: configuration.genderRulesVersion,
    showSalePriceInGoogleFeed: configuration.showSalePriceInGoogleFeed,
    useProductImageAsMainImage: configuration.useProductImageAsMainImage,
    includeShippingWeightInGoogleFeed:
      configuration.includeShippingWeightInGoogleFeed,
    excludeOutOfStockItems: configuration.excludeOutOfStockItems,
    ignoreShopifyInventoryInGoogleFeed:
      configuration.ignoreShopifyInventoryInGoogleFeed,
    inventorySourceMode: normalizeInventorySourceMode(
      configuration.inventorySourceMode,
    ),
    selectedInventoryLocationIds: normalizeInventoryLocationIds(
      configuration.selectedInventoryLocationIds,
    ),
    disableUtmParameters: configuration.disableUtmParameters,
    disablePrimaryCurrencyParameter:
      configuration.disablePrimaryCurrencyParameter,
    checkoutLinkMode: normalizeCheckoutLinkMode(configuration.checkoutLinkMode),
    updatedAt: configuration.updatedAt.toISOString(),
  };
}

function getStoredDiagnosticsRevision(configuration: StoredConfiguration) {
  return createDiagnosticsConfigurationRevision({
    ageRulesAppliedVersion: configuration.ageRulesAppliedVersion,
    colorOptions: configuration.colorOptions,
    excludedCollections: configuration.excludedCollections,
    excludedTitleTerms: configuration.excludedTitleTerms,
    genderRulesAppliedVersion: configuration.genderRulesAppliedVersion,
    sizeOptions: configuration.sizeOptions,
  });
}

async function ensureOptionMappings(
  configuration: StoredConfiguration,
): Promise<StoredConfiguration> {
  if (configuration.optionMappingsInitialized) {
    return configuration;
  }

  const colorOptions = resolveStoredOptionNames(
    configuration.colorOptions,
    configuration.colorOption,
    configuration.optionMappingsInitialized,
    DEFAULT_COLOR_OPTIONS,
  );
  const sizeOptions = resolveStoredOptionNames(
    configuration.sizeOptions,
    configuration.sizeOption,
    configuration.optionMappingsInitialized,
    DEFAULT_SIZE_OPTIONS,
  );

  return prisma.configuration.update({
    where: { id: configuration.id },
    data: {
      colorOption: null,
      colorOptions,
      optionMappingsInitialized: true,
      sizeOption: null,
      sizeOptions,
    },
  });
}

async function ensureDiagnosticsRevision(
  configuration: StoredConfiguration,
): Promise<StoredConfiguration> {
  const revision = getStoredDiagnosticsRevision(configuration);

  if (configuration.diagnosticsRevision === revision) {
    return configuration;
  }

  return prisma.configuration.update({
    where: { id: configuration.id },
    data: { diagnosticsRevision: revision },
  });
}

export async function getConfigurationPageData(
  admin: AdminGraphQLClient,
  session: { accessToken?: string; shop: string },
) {
  await ensureAttributeRuleConfigurationFields();
  const store = await upsertInstalledStore(session);
  const existingConfiguration = await prisma.configuration.findUnique({
    where: { storeId: store.id },
  });
  let bootstrap: ConfigurationBootstrapQuery | null = null;

  try {
    bootstrap = await queryShopifyAdmin<ConfigurationBootstrapQuery>(
      admin,
      CONFIGURATION_BOOTSTRAP_QUERY,
    );
  } catch (error) {
    if (!existingConfiguration) {
      throw error;
    }
  }

  const initialConfiguration =
    existingConfiguration ??
    (await prisma.configuration.upsert({
      where: { storeId: store.id },
      update: {},
      create: {
        alertsEmail:
          bootstrap?.shop.contactEmail ?? bootstrap?.shop.email ?? "",
        countryCode:
          bootstrap?.shop.billingAddress.countryCodeV2?.toUpperCase() ?? "",
        colorOptions: [...DEFAULT_COLOR_OPTIONS],
        diagnosticsRevision: createDiagnosticsConfigurationRevision({
          colorOptions: DEFAULT_COLOR_OPTIONS,
          sizeOptions: DEFAULT_SIZE_OPTIONS,
        }),
        excludedCollections: [] as Prisma.InputJsonValue,
        excludedTitleTerms: [],
        optionMappingsInitialized: true,
        showSalePriceInGoogleFeed: false,
        useProductImageAsMainImage: false,
        includeShippingWeightInGoogleFeed: false,
        excludeOutOfStockItems: false,
        ignoreShopifyInventoryInGoogleFeed: false,
        inventorySourceMode: "ALL_LOCATIONS",
        selectedInventoryLocationIds: [],
        disableUtmParameters: false,
        disablePrimaryCurrencyParameter: false,
        checkoutLinkMode: "DISABLED",
        sizeOptions: [...DEFAULT_SIZE_OPTIONS],
        storeId: store.id,
      },
    }));
  const migratedConfiguration =
    await ensureOptionMappings(initialConfiguration);
  const configuration = await ensureDiagnosticsRevision(migratedConfiguration);

  return {
    configuration: mapConfiguration(configuration),
    ruleJobs: await getAttributeRuleJobStatuses(store.id),
  };
}

export async function saveConfigurationForShop(
  admin: AdminGraphQLClient,
  session: { accessToken?: string; shop: string },
  value: unknown,
) {
  await ensureAttributeRuleConfigurationFields();
  const input = validateConfigurationInput(value);
  const store = await upsertInstalledStore(session);
  const previousConfiguration = await prisma.configuration.findUnique({
    where: { storeId: store.id },
    select: {
      ageRulesAppliedVersion: true,
      genderRulesAppliedVersion: true,
      showSalePriceInGoogleFeed: true,
      useProductImageAsMainImage: true,
      includeShippingWeightInGoogleFeed: true,
      excludeOutOfStockItems: true,
      ignoreShopifyInventoryInGoogleFeed: true,
      inventorySourceMode: true,
      selectedInventoryLocationIds: true,
      disableUtmParameters: true,
      disablePrimaryCurrencyParameter: true,
      checkoutLinkMode: true,
    },
  });
  const selectedInventoryLocationIds =
    await verifySelectedInventoryLocations(
      admin,
      input.selectedInventoryLocationIds,
      previousConfiguration?.selectedInventoryLocationIds ?? [],
    );
  const verifiedInput = {
    ...input,
    selectedInventoryLocationIds,
  };
  const nextDiagnosticsRevision = createDiagnosticsConfigurationRevision({
    ...verifiedInput,
    ageRulesAppliedVersion: previousConfiguration?.ageRulesAppliedVersion ?? 0,
    genderRulesAppliedVersion:
      previousConfiguration?.genderRulesAppliedVersion ?? 0,
  });
  const configuration = await prisma.configuration.upsert({
    where: { storeId: store.id },
    create: {
      ...verifiedInput,
      excludedCollections:
        input.excludedCollections as unknown as Prisma.InputJsonValue,
      diagnosticsRevision: nextDiagnosticsRevision,
      optionMappingsInitialized: true,
      storeId: store.id,
    },
    update: {
      ...verifiedInput,
      colorOption: null,
      excludedCollections:
        input.excludedCollections as unknown as Prisma.InputJsonValue,
      diagnosticsRevision: nextDiagnosticsRevision,
      optionMappingsInitialized: true,
      sizeOption: null,
    },
  });
  const feedUrlSettingsChanged =
    previousConfiguration === null
      ? input.showSalePriceInGoogleFeed ||
        input.useProductImageAsMainImage ||
        input.includeShippingWeightInGoogleFeed ||
        input.excludeOutOfStockItems ||
        input.ignoreShopifyInventoryInGoogleFeed ||
        input.inventorySourceMode !== "ALL_LOCATIONS" ||
        input.selectedInventoryLocationIds.length > 0 ||
        input.disableUtmParameters ||
        input.disablePrimaryCurrencyParameter ||
        input.checkoutLinkMode !== "DISABLED"
      : previousConfiguration.showSalePriceInGoogleFeed !==
          input.showSalePriceInGoogleFeed ||
        previousConfiguration.useProductImageAsMainImage !==
          input.useProductImageAsMainImage ||
        previousConfiguration.includeShippingWeightInGoogleFeed !==
          input.includeShippingWeightInGoogleFeed ||
        previousConfiguration.excludeOutOfStockItems !==
          input.excludeOutOfStockItems ||
        previousConfiguration.ignoreShopifyInventoryInGoogleFeed !==
          input.ignoreShopifyInventoryInGoogleFeed ||
        previousConfiguration.inventorySourceMode !==
          input.inventorySourceMode ||
        [...previousConfiguration.selectedInventoryLocationIds]
          .sort()
          .join("\u0000") !==
          [...input.selectedInventoryLocationIds].sort().join("\u0000") ||
        previousConfiguration.disableUtmParameters !==
          input.disableUtmParameters ||
        previousConfiguration.disablePrimaryCurrencyParameter !==
          input.disablePrimaryCurrencyParameter ||
        previousConfiguration.checkoutLinkMode !== input.checkoutLinkMode;

  if (feedUrlSettingsChanged) {
    await prisma.xmlLink.updateMany({
      where: {
        gcsObjectName: { not: null },
        storeId: store.id,
      },
      data: { requiresRefresh: true },
    });
  }
  const staleFeedCount = await prisma.xmlLink.count({
    where: {
      gcsObjectName: { not: null },
      requiresRefresh: true,
      storeId: store.id,
    },
  });

  return {
    configuration: mapConfiguration(configuration),
    feedRefreshRequired: staleFeedCount > 0,
  };
}

export async function getDiagnosticsConfigurationRules(
  shop: string,
): Promise<DiagnosticsConfigurationRules> {
  await ensureAttributeRuleConfigurationFields();
  const store = await prisma.store.findUnique({
    where: { shopDomain: normalizeShopDomain(shop) },
    include: { configuration: true },
  });
  let configuration = store?.configuration
    ? await ensureOptionMappings(store.configuration)
    : null;

  if (configuration) {
    const revision = createDiagnosticsConfigurationRevision({
      ageRulesAppliedVersion: configuration.ageRulesAppliedVersion,
      colorOptions: configuration.colorOptions,
      excludedCollections: configuration.excludedCollections,
      excludedTitleTerms: configuration.excludedTitleTerms,
      genderRulesAppliedVersion: configuration.genderRulesAppliedVersion,
      sizeOptions: configuration.sizeOptions,
    });

    if (configuration.diagnosticsRevision !== revision) {
      configuration = await prisma.configuration.update({
        where: { id: configuration.id },
        data: { diagnosticsRevision: revision },
      });
    }
  }

  return {
    colorOptions: normalizeOptionNames(
      configuration?.colorOptions ?? DEFAULT_COLOR_OPTIONS,
    ),
    excludedCollections: normalizeSelectedCollections(
      configuration?.excludedCollections,
    ),
    excludedTitleTerms: configuration?.excludedTitleTerms ?? [],
    revision:
      configuration?.diagnosticsRevision ??
      createDiagnosticsConfigurationRevision({}),
    sizeOptions: normalizeOptionNames(
      configuration?.sizeOptions ?? DEFAULT_SIZE_OPTIONS,
    ),
  };
}

function mapAttributeRuleJob(
  job: AttributeRuleJob | null,
): PublicAttributeRuleJob | null {
  if (!job) return null;
  return {
    generationCompletedAt: job.generationCompletedAt?.toISOString() ?? null,
    generationStartedAt: job.generationStartedAt?.toISOString() ?? null,
    kind: job.kind === "GENDER" ? "gender" : "age",
    lastError: job.lastError,
    processedProducts: job.processedProducts,
    ruleVersion: job.ruleVersion,
    status: job.status,
    totalProducts: job.totalProducts,
  };
}

export async function getAttributeRuleJobStatuses(
  storeId: string,
): Promise<PublicAttributeRuleJobs> {
  const jobs = await prisma.attributeRuleJob.findMany({
    where: { storeId },
  });
  return {
    age: mapAttributeRuleJob(jobs.find(({ kind }) => kind === "AGE") ?? null),
    gender: mapAttributeRuleJob(
      jobs.find(({ kind }) => kind === "GENDER") ?? null,
    ),
  };
}

export async function getAttributeRuleJobStatusesForShop(session: {
  accessToken?: string;
  shop: string;
}) {
  const store = await upsertInstalledStore(session);
  return getAttributeRuleJobStatuses(store.id);
}

function assertAttributeRuleScopes(scope: string | undefined) {
  if (!hasAttributeRuleProductAccess(scope)) {
    throw new AttributeRuleScopeError();
  }
}

async function verifiedRules<
  T extends GenderRulesConfiguration | AgeRulesConfiguration,
>(admin: AdminGraphQLClient, configuration: T): Promise<T> {
  const collections = configuration.rules.flatMap((rule) => rule.collections);
  let verified: SelectedCollection[];
  try {
    verified = await verifyShopCollections(admin, collections);
  } catch (error) {
    if (error instanceof CollectionVerificationError) {
      throw new AttributeRulesValidationError(error.message);
    }
    throw error;
  }
  const verifiedById = new Map(
    verified.map((collection) => [collection.id, collection]),
  );
  return {
    ...configuration,
    rules: configuration.rules.map((rule) => ({
      ...rule,
      collections: rule.collections.map(({ id }) => verifiedById.get(id)!),
    })),
  } as T;
}

export async function saveAttributeRulesForShop(
  admin: AdminGraphQLClient,
  session: {
    accessToken?: string;
    scope?: string;
    shop: string;
  },
  kind: PublicAttributeRuleKind,
  value: unknown,
) {
  await ensureAttributeRuleConfigurationFields();
  assertAttributeRuleScopes(session.scope);
  const store = await upsertInstalledStore(session);
  const validated =
    kind === "gender"
      ? await verifiedRules(admin, validateGenderRules(value))
      : await verifiedRules(admin, validateAgeRules(value));
  const prismaKind: AttributeRuleKind = kind === "gender" ? "GENDER" : "AGE";

  const result = await prisma.$transaction(async (transaction) => {
    const configuration =
      kind === "gender"
        ? await transaction.configuration.update({
            where: { storeId: store.id },
            data: {
              defaultGender: (validated as GenderRulesConfiguration)
                .defaultGender,
              genderRules: validated.rules as unknown as Prisma.InputJsonValue,
              genderRulesVersion: { increment: 1 },
            },
          })
        : await transaction.configuration.update({
            where: { storeId: store.id },
            data: {
              ageRules: validated.rules as unknown as Prisma.InputJsonValue,
              ageRulesVersion: { increment: 1 },
              defaultAgeGroup: (validated as AgeRulesConfiguration)
                .defaultAgeGroup,
            },
          });
    const ruleVersion =
      kind === "gender"
        ? configuration.genderRulesVersion
        : configuration.ageRulesVersion;
    const job = await transaction.attributeRuleJob.upsert({
      where: {
        storeId_kind: {
          kind: prismaKind,
          storeId: store.id,
        },
      },
      create: {
        kind: prismaKind,
        ruleVersion,
        status: "QUEUED",
        storeId: store.id,
      },
      update: {
        generationCompletedAt: null,
        generationStartedAt: null,
        lastError: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        processedProducts: 0,
        ruleVersion,
        status: "QUEUED",
        totalProducts: null,
      },
    });

    return { configuration, job };
  });

  return {
    configuration: mapConfiguration(result.configuration),
    job: mapAttributeRuleJob(result.job)!,
    ruleJobs: await getAttributeRuleJobStatuses(store.id),
  };
}

export async function retryAttributeRulesForShop(
  session: {
    accessToken?: string;
    scope?: string;
    shop: string;
  },
  kind: PublicAttributeRuleKind,
) {
  await ensureAttributeRuleConfigurationFields();
  assertAttributeRuleScopes(session.scope);
  const store = await upsertInstalledStore(session);
  const configuration = await prisma.configuration.findUnique({
    where: { storeId: store.id },
    select: {
      ageRulesVersion: true,
      genderRulesVersion: true,
    },
  });
  if (!configuration) {
    throw new AttributeRulesValidationError(
      "Open Configurations and save the rules before retrying.",
    );
  }

  const prismaKind: AttributeRuleKind = kind === "gender" ? "GENDER" : "AGE";
  const ruleVersion =
    kind === "gender"
      ? configuration.genderRulesVersion
      : configuration.ageRulesVersion;
  const retried = await prisma.attributeRuleJob.updateMany({
    where: {
      kind: prismaKind,
      status: "FAILED",
      storeId: store.id,
    },
    data: {
      generationCompletedAt: null,
      generationStartedAt: null,
      lastError: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      processedProducts: 0,
      ruleVersion,
      status: "QUEUED",
      totalProducts: null,
    },
  });
  if (retried.count === 0) {
    throw new AttributeRulesValidationError(
      "This rule job is not currently failed and does not need a retry.",
    );
  }

  return {
    ruleJobs: await getAttributeRuleJobStatuses(store.id),
  };
}
