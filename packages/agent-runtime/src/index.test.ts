import { describe, expect, it, vi } from 'vitest';
import { agentObservationSchema } from '@agentborne/shared';
import {
  AgentProviderError,
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterAgentProvider,
  ScriptedAgentProvider,
  buildOpenRouterRequest,
} from '.';
import { applyProviderEnvironmentFile } from './provider-environment';

const observation = agentObservationSchema.parse({
  agentId: '128f3f38-6b7d-4db7-9e95-751b4ce2681e',
  agentName: 'Ember',
  personality: 'Aggressively infect open cells.',
  currentCell: { cell: '892a1072893ffff', state: 'open' },
  adjacentCells: [{ cell: '892a1072883ffff', state: 'open' }],
  nearbyAgents: [],
  recentEvents: [],
});

function response(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      id: 'request-safe-id',
      model: 'google/gemini-3.7-flash',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 20, completion_tokens: 12 },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse({
  status,
  code,
  message,
  requestId = 'safe-request-id',
}: {
  status: number;
  code?: string | number;
  message?: string;
  requestId?: string;
}) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
    },
  });
}

function visitJsonValues(
  value: unknown,
  visitor: (value: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitJsonValues(item, visitor));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  visitor(record);
  Object.values(record).forEach((item) => visitJsonValues(item, visitor));
}

describe('OpenRouterAgentProvider', () => {
  it('constructs a Gemini-compatible strict structured-output request', () => {
    const request = buildOpenRouterRequest(observation);
    expect(request.model).toBe('google/gemini-3.7-flash');
    expect(DEFAULT_OPENROUTER_MODEL).toBe('google/gemini-3.7-flash');
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
    expect(request.provider).toEqual({ require_parameters: true });
    expect(request.stream).toBe(false);
    expect(request.max_tokens).toBe(1024);
    expect(request).not.toHaveProperty('max_completion_tokens');
    expect(request).not.toHaveProperty('include_reasoning');
    expect(request).not.toHaveProperty('reasoning_effort');
    expect(request.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(request.messages[1]!.content).toContain(observation.personality);
    expect(request.messages[0]!.content).toContain('Never produce messages');
    expect(request.messages[0]!.content).toContain(
      'subordinate behavioral guidance',
    );
    expect(request.messages[0]!.content).not.toContain(observation.personality);

    const schema = request.response_format.json_schema.schema;
    expect(schema.type).toBe('object');
    expect(schema.properties.requestedAction).toHaveProperty('anyOf');
    expect(schema.properties.requestedAction.anyOf).toHaveLength(3);

    visitJsonValues(schema, (schemaNode) => {
      expect(schemaNode).not.toHaveProperty('oneOf');
      expect(schemaNode).not.toHaveProperty('const');
      if (schemaNode.type !== 'object') return;
      expect(schemaNode.additionalProperties).toBe(false);
      const properties = schemaNode.properties as
        Record<string, unknown> | undefined;
      expect(properties).toBeDefined();
      expect([...(schemaNode.required as string[])].sort()).toEqual(
        Object.keys(properties!).sort(),
      );
    });
  });

  it('preserves an explicit model override', () => {
    expect(
      buildOpenRouterRequest(observation, 'custom/provider-model').model,
    ).toBe('custom/provider-model');
  });

  it('parses and runtime-validates a structured decision', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImplementation: typeof fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedInit = init;
        return response(
          JSON.stringify({
            requestedAction: { type: 'infect' },
            summary: 'Claiming this cell.',
          }),
        );
      },
    );
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation,
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { requestedAction: { type: 'infect' } },
      metadata: { provider: 'openrouter' },
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      provider: { require_parameters: true },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not-json', 'malformed-response'],
    [
      JSON.stringify({ requestedAction: { type: 'teleport' }, summary: 'No.' }),
      'unsupported-response',
    ],
    [
      JSON.stringify({
        requestedAction: { type: 'wait' },
        summary: 'x'.repeat(241),
      }),
      'unsupported-response',
    ],
  ])(
    'rejects invalid provider content without fallback',
    async (content, code) => {
      const provider = new OpenRouterAgentProvider({
        apiKey: 'secret-test-key',
        fetchImplementation: vi.fn(async () => response(content)),
      });
      await expect(provider.decide(observation)).rejects.toMatchObject({
        failure: { code },
      });
    },
  );

  it.each([
    [400, 'The model provider rejected the request configuration.', false],
    [
      404,
      'The selected model is unavailable or no endpoint supports all required parameters.',
      false,
    ],
    [429, 'The model provider rate limited the request.', true],
    [503, 'The model provider is unavailable.', true],
  ])(
    'maps HTTP %i to a clear sanitized public failure',
    async (status, message, retryable) => {
      const provider = new OpenRouterAgentProvider({
        apiKey: 'secret-test-key',
        fetchImplementation: vi.fn(async () =>
          errorResponse({
            status,
            code: 'provider_error',
            message: 'Safe provider detail.',
          }),
        ),
      });
      await expect(provider.decide(observation)).rejects.toMatchObject({
        failure: { code: 'provider-http', message, retryable },
        diagnostics: {
          httpStatus: status,
          providerCode: 'provider_error',
          providerMessage: 'Safe provider detail.',
          requestId: 'safe-request-id',
          model: 'google/gemini-3.7-flash',
        },
      });
    },
  );

  it('sanitizes HTTP diagnostics and network errors without leaking sensitive data', async () => {
    const key = 'highly-sensitive-key';
    const injectedSensitiveString = 'injected-sensitive-observation';
    const sensitiveObservation = agentObservationSchema.parse({
      ...observation,
      personality: injectedSensitiveString,
    });
    const httpProvider = new OpenRouterAgentProvider({
      apiKey: key,
      fetchImplementation: vi.fn(async () =>
        errorResponse({
          status: 400,
          code: `invalid-${key}`,
          message: `Authorization: Bearer ${key}; observation=${injectedSensitiveString}`,
          requestId: `request-${key}`,
        }),
      ),
    });
    const networkProvider = new OpenRouterAgentProvider({
      apiKey: key,
      fetchImplementation: vi.fn(async () => {
        throw new Error(`socket failed with ${key}`);
      }),
    });
    for (const provider of [httpProvider, networkProvider]) {
      try {
        await provider.decide(
          provider === httpProvider ? sensitiveObservation : observation,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(AgentProviderError);
        expect(String(error)).not.toContain(key);
        expect(JSON.stringify(error)).not.toContain(key);
        expect(JSON.stringify(error)).not.toContain(injectedSensitiveString);
      }
    }
  });

  it('reads only a bounded OpenRouter error body', async () => {
    const oversizedMessage = 'safe-detail '.repeat(4_000);
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(async () =>
        errorResponse({
          status: 400,
          code: 'invalid_request',
          message: oversizedMessage,
        }),
      ),
    });
    try {
      await provider.decide(observation);
    } catch (error) {
      expect(error).toBeInstanceOf(AgentProviderError);
      expect((error as AgentProviderError).diagnostics?.providerMessage).toBe(
        undefined,
      );
    }
  });

  it('times out a bounded request', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      timeoutMs: 1,
      fetchImplementation: vi.fn(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    });
    await expect(provider.decide(observation)).rejects.toMatchObject({
      failure: { code: 'timeout' },
    });
  });

  it('keeps the timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | null | undefined;
      const provider = new OpenRouterAgentProvider({
        apiKey: 'secret-test-key',
        timeoutMs: 10,
        fetchImplementation: vi.fn(async (_url, init) => {
          requestSignal = init?.signal;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () =>
              new Promise((_resolve, reject) => {
                requestSignal?.addEventListener('abort', () =>
                  reject(new DOMException('aborted', 'AbortError')),
                );
              }),
          } as Response;
        }),
      });
      const pending = expect(
        provider.decide(observation),
      ).rejects.toMatchObject({ failure: { code: 'timeout' } });

      await vi.advanceTimersByTimeAsync(10);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the timeout after a successful response', async () => {
    vi.useFakeTimers();
    try {
      const provider = new OpenRouterAgentProvider({
        apiKey: 'secret-test-key',
        fetchImplementation: vi.fn(async () =>
          response(
            JSON.stringify({
              requestedAction: { type: 'wait' },
              summary: 'Done.',
            }),
          ),
        ),
      });

      await expect(provider.decide(observation)).resolves.toBeDefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports missing configuration instead of using a heuristic fallback', async () => {
    const provider = new OpenRouterAgentProvider();
    await expect(provider.decide(observation)).rejects.toMatchObject({
      failure: { code: 'configuration' },
    });
  });
});

describe('OpenRouter provider environment', () => {
  it('loads only server provider values and overrides stale exports', () => {
    const environment: Record<string, string | undefined> = {
      OPENROUTER_API_KEY: 'exported-key',
    };
    applyProviderEnvironmentFile(
      [
        'OPENROUTER_API_KEY=file-key',
        'AGENTBORNE_MODEL=google/gemini-3.7-flash',
        'NEXT_PUBLIC_GAME_API_BASE_URL=https://browser.example',
      ].join('\n'),
      environment,
    );
    expect(environment).toEqual({
      OPENROUTER_API_KEY: 'file-key',
      AGENTBORNE_MODEL: 'google/gemini-3.7-flash',
    });
  });
});

describe('ScriptedAgentProvider', () => {
  it('returns explicitly scripted decisions in order', async () => {
    const provider = new ScriptedAgentProvider([
      { requestedAction: { type: 'wait' }, summary: 'Staying still.' },
      { requestedAction: { type: 'infect' }, summary: 'Infecting.' },
    ]);
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { requestedAction: { type: 'wait' } },
      metadata: { provider: 'scripted-test' },
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { requestedAction: { type: 'infect' } },
    });
  });

  it('rejects an empty script', () => {
    expect(() => new ScriptedAgentProvider([])).toThrow(
      /at least one decision/,
    );
  });
});
