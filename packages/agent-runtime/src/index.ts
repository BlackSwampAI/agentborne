import { z } from 'zod';
import {
  agentDecisionSchema,
  agentObservationSchema,
  type AgentDecision,
  type AgentObservation,
  type ProviderFailure,
  type ProviderMetadata,
} from '@agentborne/shared';

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5-mini';
export const OPENROUTER_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions';

export interface ProviderDecision {
  decision: AgentDecision;
  metadata: ProviderMetadata;
}

/** Providers receive immutable data and never receive a world handle. */
export interface AgentProvider {
  readonly mode: 'openrouter' | 'scripted-test';
  readonly model: string;
  readonly configured: boolean;
  decide(observation: AgentObservation): Promise<ProviderDecision>;
}

export class AgentProviderError extends Error {
  constructor(
    readonly failure: ProviderFailure,
    readonly metadata?: ProviderMetadata,
  ) {
    super(failure.message);
    this.name = 'AgentProviderError';
  }
}

const decisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestedAction: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { const: 'move' },
            targetCell: {
              type: 'string',
              pattern: '^[0-9a-fA-F]{15}$',
              description:
                'One target H3 index copied exactly from adjacentCells.',
            },
          },
          required: ['type', 'targetCell'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: { type: { const: 'infect' } },
          required: ['type'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: { type: { const: 'wait' } },
          required: ['type'],
        },
      ],
    },
    summary: {
      type: 'string',
      minLength: 1,
      maxLength: 240,
      description:
        'A concise user-visible decision summary, not hidden reasoning.',
    },
  },
  required: ['requestedAction', 'summary'],
} as const;

export function buildOpenRouterRequest(
  observationInput: AgentObservation,
  model = DEFAULT_OPENROUTER_MODEL,
) {
  const observation = agentObservationSchema.parse(observationInput);
  return {
    model,
    messages: [
      {
        role: 'system' as const,
        content:
          'You control one map agent. Choose exactly one permitted action from the supplied observation. Follow the fixed personality as behavioral guidance. A move target must be copied from adjacentCells. Never produce messages, private chain-of-thought, hidden reasoning, analysis, or extra fields. Return only the strict structured decision and one concise user-visible summary.',
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          purpose: 'Choose the next action from this immutable observation.',
          observation,
        }),
      },
    ],
    response_format: {
      type: 'json_schema' as const,
      json_schema: {
        name: 'agentborne_agent_decision',
        strict: true,
        schema: decisionJsonSchema,
      },
    },
    provider: { require_parameters: true },
    max_tokens: 180,
    stream: false,
  };
}

const openRouterResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable() }),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export interface OpenRouterProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

export class OpenRouterAgentProvider implements AgentProvider {
  readonly mode = 'openrouter' as const;
  readonly model: string;
  readonly configured: boolean;
  readonly #apiKey?: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor({
    apiKey,
    model = DEFAULT_OPENROUTER_MODEL,
    timeoutMs = 15_000,
    fetchImplementation = fetch,
  }: OpenRouterProviderOptions = {}) {
    this.#apiKey = apiKey?.trim() || undefined;
    this.model = model.trim() || DEFAULT_OPENROUTER_MODEL;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImplementation;
    this.configured = Boolean(this.#apiKey);
  }

  async decide(observation: AgentObservation): Promise<ProviderDecision> {
    const started = Date.now();
    if (!this.#apiKey) {
      throw new AgentProviderError({
        code: 'configuration',
        message:
          'OpenRouter is unavailable. Set OPENROUTER_API_KEY on the Game API server.',
        retryable: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildOpenRouterRequest(observation, this.model)),
        signal: controller.signal,
      });
    } catch {
      const timedOut = controller.signal.aborted;
      throw new AgentProviderError({
        code: timedOut ? 'timeout' : 'network',
        message: timedOut
          ? 'The model request timed out.'
          : 'The model provider could not be reached.',
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      throw new AgentProviderError(
        {
          code: 'provider-http',
          message: `The model provider returned HTTP ${response.status}.`,
          retryable: response.status === 429 || response.status >= 500,
        },
        {
          provider: 'openrouter',
          model: this.model,
          requestId: response.headers.get('x-request-id') ?? undefined,
          latencyMs,
        },
      );
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new AgentProviderError({
        code: 'malformed-response',
        message: 'The model provider returned malformed JSON.',
        retryable: true,
      });
    }

    const parsedResponse = openRouterResponseSchema.safeParse(raw);
    if (!parsedResponse.success) {
      throw new AgentProviderError({
        code: 'unsupported-response',
        message: 'The model provider returned an unsupported response shape.',
        retryable: true,
      });
    }
    const content = parsedResponse.data.choices[0]?.message.content;
    if (!content) {
      throw new AgentProviderError({
        code: 'unsupported-response',
        message: 'The model provider returned no structured decision.',
        retryable: true,
      });
    }

    let decisionInput: unknown;
    try {
      decisionInput = JSON.parse(content);
    } catch {
      throw new AgentProviderError({
        code: 'malformed-response',
        message: 'The model decision was not valid JSON.',
        retryable: true,
      });
    }
    const decision = agentDecisionSchema.safeParse(decisionInput);
    if (!decision.success) {
      throw new AgentProviderError({
        code: 'unsupported-response',
        message: 'The model decision failed runtime schema validation.',
        retryable: true,
      });
    }

    return {
      decision: decision.data,
      metadata: {
        provider: 'openrouter',
        model: parsedResponse.data.model ?? this.model,
        requestId:
          parsedResponse.data.id ??
          response.headers.get('x-request-id') ??
          undefined,
        latencyMs,
        promptTokens: parsedResponse.data.usage?.prompt_tokens,
        completionTokens: parsedResponse.data.usage?.completion_tokens,
      },
    };
  }
}

export class ScriptedAgentProvider implements AgentProvider {
  readonly mode = 'scripted-test' as const;
  readonly model = 'deterministic-script';
  readonly configured = true;
  readonly #decisions: AgentDecision[];
  #cursor = 0;

  constructor(decisions: AgentDecision[]) {
    if (decisions.length === 0) {
      throw new Error('ScriptedAgentProvider requires at least one decision.');
    }
    this.#decisions = decisions.map((decision) =>
      agentDecisionSchema.parse(decision),
    );
  }

  async decide(observation: AgentObservation): Promise<ProviderDecision> {
    agentObservationSchema.parse(observation);
    const decision = this.#decisions[this.#cursor];
    if (!decision) {
      throw new AgentProviderError({
        code: 'unsupported-response',
        message: 'The deterministic test script has no decision remaining.',
        retryable: false,
      });
    }
    this.#cursor += 1;
    return {
      decision: structuredClone(decision),
      metadata: {
        provider: 'scripted-test',
        model: this.model,
        latencyMs: 0,
      },
    };
  }
}

/** Explicit deterministic browser/CI provider; never selected by fallback. */
export class BrowserTestAgentProvider implements AgentProvider {
  readonly mode = 'scripted-test' as const;
  readonly model = 'deterministic-browser-script';
  readonly configured = true;

  async decide(observationInput: AgentObservation): Promise<ProviderDecision> {
    const observation = agentObservationSchema.parse(observationInput);
    const requestedAction =
      observation.currentCell.state === 'open'
        ? ({ type: 'infect' } as const)
        : ({
            type: 'move',
            targetCell: observation.adjacentCells[0]!.cell,
          } as const);
    return {
      decision: {
        requestedAction,
        summary:
          requestedAction.type === 'infect'
            ? 'Infecting this open cell.'
            : 'Moving to the first adjacent cell in the test script.',
      },
      metadata: {
        provider: 'scripted-test',
        model: this.model,
        latencyMs: 0,
      },
    };
  }
}
