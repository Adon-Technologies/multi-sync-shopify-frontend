import { queryOptions } from "@tanstack/react-query";

import type { CollectionSearchPage } from "./collection-search.server";
import type {
  PublicAttributeRuleJob,
  PublicAttributeRuleJobs,
  PublicConfiguration,
} from "./configuration.server";
import type {
  AgeRulesConfiguration,
  AttributeRuleKind,
  GenderRulesConfiguration,
} from "./attribute-rules";
import {
  normalizeConfigurationText,
  type ConfigurationFieldErrors,
  type ConfigurationInput,
} from "./configuration-validation";

export interface ConfigurationQueryScope {
  shop: string;
  sessionId: string;
}

interface ConfigurationResponse {
  ok: true;
  intent: "configuration";
  configuration: PublicConfiguration;
  ruleJobs: PublicAttributeRuleJobs;
}

interface CollectionsResponse {
  ok: true;
  intent: "collections";
  page: CollectionSearchPage;
}

interface OptionNamesResponse {
  ok: true;
  intent: "option-names";
  optionNames: string[];
}

interface SaveConfigurationResponse {
  ok: true;
  configuration: PublicConfiguration;
  feedRefreshRequired: boolean;
}

interface AttributeRuleStatusResponse {
  ok: true;
  intent: "rule-status";
  ruleJobs: PublicAttributeRuleJobs;
}

interface SaveAttributeRulesResponse {
  ok: true;
  configuration: PublicConfiguration;
  job: PublicAttributeRuleJob;
  ruleJobs: PublicAttributeRuleJobs;
}

interface RetryAttributeRulesResponse {
  ok: true;
  ruleJobs: PublicAttributeRuleJobs;
}

interface ErrorResponse {
  ok: false;
  error: string;
  fields?: ConfigurationFieldErrors;
}

export class ConfigurationRequestError extends Error {
  readonly fields?: ConfigurationFieldErrors;

  constructor(message: string, fields?: ConfigurationFieldErrors) {
    super(message);
    this.name = "ConfigurationRequestError";
    this.fields = fields;
  }
}

const defaultEndpoint = "/app/configuration-data";
const sessionCacheOptions = {
  gcTime: Infinity,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Infinity,
} as const;

export const configurationKeys = {
  configuration: (
    { shop, sessionId }: ConfigurationQueryScope,
    endpoint = defaultEndpoint,
  ) => ["configuration", shop, sessionId, endpoint] as const,
  optionNames: (
    { shop, sessionId }: ConfigurationQueryScope,
    endpoint = defaultEndpoint,
  ) => ["configuration-option-names", shop, sessionId, endpoint] as const,
  ruleStatus: (
    { shop, sessionId }: ConfigurationQueryScope,
    endpoint = defaultEndpoint,
  ) => ["configuration-rule-status", shop, sessionId, endpoint] as const,
  collections: (
    { shop, sessionId }: ConfigurationQueryScope,
    search: string,
    after: string | null,
    endpoint = defaultEndpoint,
  ) =>
    [
      "configuration-collections",
      shop,
      sessionId,
      normalizeConfigurationText(search).toLocaleLowerCase(),
      after ?? "start",
      endpoint,
    ] as const,
};

async function readJson<TValue extends { ok: true }>(response: Response) {
  const payload = (await response.json()) as TValue | ErrorResponse;

  if (!response.ok || payload.ok === false) {
    const error = payload as ErrorResponse;
    throw new ConfigurationRequestError(
      error.error || "Configuration request failed.",
      error.fields,
    );
  }

  return payload as TValue;
}

export function configurationQueryOptions(
  scope: ConfigurationQueryScope,
  endpoint = defaultEndpoint,
) {
  return queryOptions({
    ...sessionCacheOptions,
    queryKey: configurationKeys.configuration(scope, endpoint),
    queryFn: async ({ signal }): Promise<ConfigurationResponse> => {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });

      return readJson<ConfigurationResponse>(response);
    },
  });
}

export function attributeRuleStatusQueryOptions(
  scope: ConfigurationQueryScope,
  endpoint = defaultEndpoint,
) {
  const params = new URLSearchParams({ intent: "rule-status" });
  return queryOptions({
    ...sessionCacheOptions,
    queryKey: configurationKeys.ruleStatus(scope, endpoint),
    queryFn: async ({ signal }): Promise<PublicAttributeRuleJobs> => {
      const response = await fetch(`${endpoint}?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await readJson<AttributeRuleStatusResponse>(response);
      return payload.ruleJobs;
    },
    refetchInterval: (query) => {
      const jobs = query.state.data;
      return jobs &&
        [jobs.age, jobs.gender].some(
          (job) => job?.status === "QUEUED" || job?.status === "PROCESSING",
        )
        ? 2_000
        : false;
    },
  });
}

export function collectionsQueryOptions(
  scope: ConfigurationQueryScope,
  search: string,
  after: string | null,
  endpoint = defaultEndpoint,
) {
  const normalizedSearch = normalizeConfigurationText(search);
  const params = new URLSearchParams({ intent: "collections" });

  if (normalizedSearch) {
    params.set("search", normalizedSearch);
  }

  if (after) {
    params.set("after", after);
  }

  return queryOptions({
    ...sessionCacheOptions,
    queryKey: configurationKeys.collections(
      scope,
      normalizedSearch,
      after,
      endpoint,
    ),
    queryFn: async ({ signal }): Promise<CollectionSearchPage> => {
      const response = await fetch(`${endpoint}?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await readJson<CollectionsResponse>(response);
      return payload.page;
    },
  });
}

export function variantOptionNamesQueryOptions(
  scope: ConfigurationQueryScope,
  endpoint = defaultEndpoint,
) {
  const params = new URLSearchParams({ intent: "option-names" });

  return queryOptions({
    ...sessionCacheOptions,
    queryKey: configurationKeys.optionNames(scope, endpoint),
    queryFn: async ({ signal }): Promise<string[]> => {
      const response = await fetch(`${endpoint}?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await readJson<OptionNamesResponse>(response);
      return payload.optionNames;
    },
  });
}

export async function saveConfigurationRequest(
  value: ConfigurationInput,
  endpoint = defaultEndpoint,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });

  return readJson<SaveConfigurationResponse>(response);
}

export async function saveAttributeRulesRequest(
  kind: AttributeRuleKind,
  configuration: GenderRulesConfiguration | AgeRulesConfiguration,
  endpoint = defaultEndpoint,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      configuration,
      intent: "save-attribute-rules",
      kind,
    }),
  });

  return readJson<SaveAttributeRulesResponse>(response);
}

export async function retryAttributeRulesRequest(
  kind: AttributeRuleKind,
  endpoint = defaultEndpoint,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "retry-attribute-rules",
      kind,
    }),
  });

  return readJson<RetryAttributeRulesResponse>(response);
}
