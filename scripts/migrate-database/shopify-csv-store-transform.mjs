import { basename } from "node:path";

import { isValidShopDomain, normalizeShopDomain } from "./store-transform.mjs";

export function parseCsv(text) {
  const rows = [];
  let field = "";
  let quoted = false;
  let row = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error("CSV contains an unexpected quote");
      }
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) throw new Error("CSV is empty");

  rows[0][0] = rows[0][0]?.replace(/^\uFEFF/, "") ?? "";
  const headers = rows[0].map((value) => value.trim());
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new Error(
      `CSV has duplicate headers: ${[...new Set(duplicateHeaders)].join(", ")}`,
    );
  }

  return rows
    .slice(1)
    .filter((values) => values.some((value) => value.trim().length > 0))
    .map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(
          `CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}`,
        );
      }
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index]]),
      );
    });
}

export function parseShopifyInstallDate(value) {
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, "$1T$2Z")
      : "";
  const date = new Date(normalized);
  if (!normalized || !Number.isFinite(date.getTime())) {
    throw new Error(`Invalid Shopify install date: ${String(value)}`);
  }
  return date;
}

export function readShopifyMerchantRows(text, sourceFile) {
  const rows = parseCsv(text);
  const requiredHeaders = ["Shop domain", "Shop plan", "Install date"];
  for (const header of requiredHeaders) {
    if (!rows[0] || !(header in rows[0])) {
      throw new Error(`CSV is missing required header: ${header}`);
    }
  }

  const seenDomains = new Set();
  return rows
    .map((row, index) => {
      const shopDomain = normalizeShopDomain(row["Shop domain"]);
      if (!isValidShopDomain(shopDomain)) {
        throw new Error(`CSV row ${index + 2} has an invalid Shop domain`);
      }
      if (seenDomains.has(shopDomain)) {
        throw new Error(`CSV contains duplicate shop: ${shopDomain}`);
      }
      seenDomains.add(shopDomain);

      return {
        installDate: parseShopifyInstallDate(row["Install date"]),
        shopDomain,
        shopPlan: row["Shop plan"].trim(),
        sourceCollection: basename(sourceFile),
      };
    })
    .sort((left, right) => left.shopDomain.localeCompare(right.shopDomain));
}

function validDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function buildCsvReconciliationEntry({
  existingStore = null,
  generatedAt,
  merchant,
}) {
  if (!validDate(generatedAt)) {
    throw new Error("generatedAt must be a valid Date");
  }
  const warnings = [];
  const accessTokenAvailable =
    typeof existingStore?.accessToken === "string" &&
    existingStore.accessToken.trim().length > 0;
  const shopIsInactive = merchant.shopPlan.toLowerCase() === "inactive";

  if (shopIsInactive) {
    warnings.push(
      'Shopify CSV reports the shop plan as "Inactive"; app status remains INSTALLED under the approved CSV policy',
    );
  }
  if (!accessTokenAvailable) {
    warnings.push(
      existingStore
        ? "Store has no access token; status is still proposed as INSTALLED because the Shopify CSV is authoritative"
        : "Missing Store has no access token; it will need OAuth/token recovery before authenticated Shopify API calls",
    );
  }

  if (existingStore) {
    const reactivating = existingStore.status !== "INSTALLED";
    if (reactivating) {
      warnings.push(
        `Existing MongoDB status ${String(existingStore.status)} will be changed to INSTALLED`,
      );
    }

    return {
      action: reactivating ? "reactivate" : "update",
      sourceShopDomain: merchant.shopDomain,
      shopifyPlan: merchant.shopPlan,
      accessTokenAvailable,
      warnings,
      targetId: String(existingStore._id),
      before: {
        shopDomain: merchant.shopDomain,
        shopPlan:
          typeof existingStore.shopPlan === "string"
            ? existingStore.shopPlan
            : null,
        status: existingStore.status,
        uninstalledAt: existingStore.uninstalledAt ?? null,
        updatedAt: existingStore.updatedAt,
      },
      changes: {
        shopPlan: merchant.shopPlan,
        status: "INSTALLED",
        uninstalledAt: null,
        updatedAt: generatedAt,
      },
      document: null,
    };
  }

  return {
    action: "insert",
    sourceShopDomain: merchant.shopDomain,
    accessTokenAvailable,
    shopifyPlan: merchant.shopPlan,
    warnings,
    targetId: null,
    before: null,
    changes: null,
    document: {
      shopDomain: merchant.shopDomain,
      shopPlan: merchant.shopPlan,
      accessStatus: "ACTIVE",
      accessToken: null,
      status: "INSTALLED",
      installedAt: merchant.installDate,
      createdAt: merchant.installDate,
      updatedAt: generatedAt,
      uninstalledAt: null,
      feedGenerationFeedId: null,
      feedGenerationLockedAt: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenRefreshLockId: null,
      tokenRefreshLockedAt: null,
    },
  };
}
