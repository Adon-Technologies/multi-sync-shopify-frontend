import prisma from "../db.server";

let migrationPromise: Promise<void> | null = null;

/**
 * Prisma db push creates MongoDB indexes but does not backfill scalar defaults
 * in existing documents. Run this small, idempotent migration before any code
 * reads newly required Configuration fields.
 */
export function ensureAttributeRuleConfigurationFields() {
  if (!migrationPromise) {
    migrationPromise = prisma
      .$runCommandRaw({
        update: "Configuration",
        updates: [
          {
            multi: true,
            q: { genderRulesVersion: { $exists: false } },
            u: { $set: { genderRulesVersion: 0 } },
          },
          {
            multi: true,
            q: { ageRulesVersion: { $exists: false } },
            u: { $set: { ageRulesVersion: 0 } },
          },
          {
            multi: true,
            q: { genderRulesAppliedVersion: { $exists: false } },
            u: { $set: { genderRulesAppliedVersion: 0 } },
          },
          {
            multi: true,
            q: { ageRulesAppliedVersion: { $exists: false } },
            u: { $set: { ageRulesAppliedVersion: 0 } },
          },
          {
            multi: true,
            q: { disableUtmParameters: { $exists: false } },
            u: { $set: { disableUtmParameters: false } },
          },
          {
            multi: true,
            q: {
              disablePrimaryCurrencyParameter: { $exists: false },
            },
            u: {
              $set: { disablePrimaryCurrencyParameter: false },
            },
          },
          {
            multi: true,
            q: { checkoutLinkMode: { $exists: false } },
            u: { $set: { checkoutLinkMode: "DISABLED" } },
          },
          {
            multi: true,
            q: { useProductImageAsMainImage: { $exists: false } },
            u: { $set: { useProductImageAsMainImage: false } },
          },
          {
            multi: true,
            q: {
              includeShippingWeightInGoogleFeed: { $exists: false },
            },
            u: {
              $set: { includeShippingWeightInGoogleFeed: false },
            },
          },
          {
            multi: true,
            q: { excludeOutOfStockItems: { $exists: false } },
            u: { $set: { excludeOutOfStockItems: false } },
          },
          {
            multi: true,
            q: {
              ignoreShopifyInventoryInGoogleFeed: { $exists: false },
            },
            u: {
              $set: { ignoreShopifyInventoryInGoogleFeed: false },
            },
          },
          {
            multi: true,
            q: { inventorySourceMode: { $exists: false } },
            u: { $set: { inventorySourceMode: "ALL_LOCATIONS" } },
          },
          {
            multi: true,
            q: { selectedInventoryLocationIds: { $exists: false } },
            u: { $set: { selectedInventoryLocationIds: [] } },
          },
          {
            multi: true,
            q: { productTypes: { $exists: false } },
            u: { $set: { productTypes: [] } },
          },
        ],
      })
      .then(() => undefined)
      .catch((error) => {
        migrationPromise = null;
        throw error;
      });
  }

  return migrationPromise;
}
