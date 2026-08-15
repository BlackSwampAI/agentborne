import { z } from 'zod';
import {
  compatibleModelSchema,
  modelCatalogResponseSchema,
  OPENROUTER_MODEL_CONTEXT_MINIMUM,
  OPENROUTER_REQUIRED_PARAMETERS,
  type CompatibleModel,
  type ModelCatalogResponse,
} from '@agentborne/shared';

export const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
export const DEFAULT_MODEL_CATALOG_TTL_MS = 5 * 60 * 1_000;

const decimalPriceSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/)
  .max(80);

const rawModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(160),
  created: z.number().int().nonnegative().optional(),
  context_length: z.number().int().positive(),
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }),
  pricing: z.object({
    prompt: decimalPriceSchema,
    completion: decimalPriceSchema,
    request: decimalPriceSchema.optional(),
  }),
  supported_parameters: z.array(z.string().trim().min(1).max(80)).max(80),
  expiration_date: z.string().nullable().optional(),
});

const rawCatalogSchema = z.object({ data: z.array(z.unknown()) });

export interface ModelCatalogOptions {
  apiKey?: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
}

type CatalogError = NonNullable<ModelCatalogResponse['error']>;

export class OpenRouterModelCatalog {
  readonly #apiKey?: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #ttlMs: number;
  readonly #now: () => number;
  #cache?: {
    models: CompatibleModel[];
    filteredOutCount: number;
    fetchedAtMs: number;
  };
  #pending?: Promise<ModelCatalogResponse>;

  constructor({
    apiKey,
    fetchImplementation = fetch,
    timeoutMs = 8_000,
    ttlMs = DEFAULT_MODEL_CATALOG_TTL_MS,
    now = Date.now,
  }: ModelCatalogOptions = {}) {
    this.#apiKey = apiKey?.trim() || undefined;
    this.#fetch = fetchImplementation;
    this.#timeoutMs = timeoutMs;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  async getCatalog(forceRefresh = false): Promise<ModelCatalogResponse> {
    const now = this.#now();
    if (
      !forceRefresh &&
      this.#cache &&
      now < this.#cache.fetchedAtMs + this.#ttlMs
    )
      return this.#responseFromCache(false);
    if (this.#pending) return this.#pending;
    this.#pending = this.#refresh().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  #responseFromCache(
    stale: boolean,
    error?: CatalogError,
  ): ModelCatalogResponse {
    const cache = this.#cache;
    return modelCatalogResponseSchema.parse({
      models: cache?.models ?? [],
      filteredOutCount: cache?.filteredOutCount ?? 0,
      fetchedAt: cache ? new Date(cache.fetchedAtMs).toISOString() : undefined,
      expiresAt: cache
        ? new Date(cache.fetchedAtMs + this.#ttlMs).toISOString()
        : undefined,
      stale,
      error,
      requirements: catalogRequirements(),
    });
  }

  async #refresh(): Promise<ModelCatalogResponse> {
    if (!this.#apiKey)
      return this.#responseFromCache(Boolean(this.#cache), {
        code: 'configuration',
        message:
          'OpenRouter catalog access requires OPENROUTER_API_KEY on the Game API server.',
      });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const url = new URL(OPENROUTER_MODELS_ENDPOINT);
      url.searchParams.set('input_modalities', 'text');
      url.searchParams.set('output_modalities', 'text');
      url.searchParams.set('context', String(OPENROUTER_MODEL_CONTEXT_MINIMUM));
      url.searchParams.set(
        'supported_parameters',
        OPENROUTER_REQUIRED_PARAMETERS.join(','),
      );
      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers: { Authorization: `Bearer ${this.#apiKey}` },
          signal: controller.signal,
        });
      } catch {
        return this.#responseFromCache(Boolean(this.#cache), {
          code: controller.signal.aborted ? 'timeout' : 'network',
          message: controller.signal.aborted
            ? 'The OpenRouter model catalog request timed out.'
            : 'The OpenRouter model catalog could not be reached.',
        });
      }
      if (!response.ok)
        return this.#responseFromCache(Boolean(this.#cache), {
          code: 'provider-http',
          message: `OpenRouter model catalog returned HTTP ${response.status}.`,
        });
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return this.#responseFromCache(Boolean(this.#cache), invalidResponse());
      }
      const parsedRoot = rawCatalogSchema.safeParse(raw);
      if (!parsedRoot.success)
        return this.#responseFromCache(Boolean(this.#cache), invalidResponse());

      const models: CompatibleModel[] = [];
      let filteredOutCount = 0;
      for (const entry of parsedRoot.data.data) {
        const model = sanitizeCompatibleModel(entry);
        if (model) models.push(model);
        else filteredOutCount += 1;
      }
      const uniqueModels = [
        ...new Map(models.map((model) => [model.id, model])).values(),
      ];
      filteredOutCount += models.length - uniqueModels.length;
      this.#cache = {
        models: uniqueModels,
        filteredOutCount,
        fetchedAtMs: this.#now(),
      };
      return this.#responseFromCache(false);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function sanitizeCompatibleModel(
  input: unknown,
): CompatibleModel | undefined {
  const parsed = rawModelSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const model = parsed.data;
  const required = new Set(OPENROUTER_REQUIRED_PARAMETERS);
  if (
    !model.architecture.input_modalities.includes('text') ||
    !model.architecture.output_modalities.includes('text') ||
    model.context_length < OPENROUTER_MODEL_CONTEXT_MINIMUM ||
    [...required].some(
      (parameter) => !model.supported_parameters.includes(parameter),
    )
  )
    return undefined;
  const expirationDate = normalizeExpirationDate(model.expiration_date);
  if (model.expiration_date && expirationDate === undefined) return undefined;
  const requestPrice = model.pricing.request;
  return compatibleModelSchema.parse({
    id: model.id,
    name: model.name,
    author: model.id.includes('/') ? model.id.split('/')[0] : model.id,
    contextLength: model.context_length,
    inputPricePerToken: model.pricing.prompt,
    outputPricePerToken: model.pricing.completion,
    requestPrice,
    supportedParameters: [...new Set(model.supported_parameters)].toSorted(),
    createdAt:
      model.created === undefined
        ? undefined
        : new Date(model.created * 1_000).toISOString(),
    expirationDate,
    isFree:
      Number(model.pricing.prompt) === 0 &&
      Number(model.pricing.completion) === 0 &&
      Number(requestPrice ?? '0') === 0,
  });
}

function normalizeExpirationDate(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match?.[0];
}

function invalidResponse(): CatalogError {
  return {
    code: 'invalid-response',
    message: 'OpenRouter returned an invalid model catalog response.',
  };
}

function catalogRequirements() {
  return {
    input: 'text' as const,
    output: 'text' as const,
    endpoint: 'chat-completions' as const,
    requiredParameters: [...OPENROUTER_REQUIRED_PARAMETERS],
    minimumContextLength: OPENROUTER_MODEL_CONTEXT_MINIMUM,
    streaming: false as const,
  };
}
