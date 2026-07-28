import prisma from "../db.server";

let migrationPromise: Promise<void> | null = null;

/**
 * Prisma db push creates MongoDB indexes but does not backfill scalar defaults
 * in existing documents. Run this small, idempotent migration before any code
 * reads the new required version fields.
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
