import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_MAX_LENGTH, agentObservationSchema } from '@agentborne/shared';
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
  currentCell: {
    cell: '892a1072893ffff',
    state: 'open',
    controllerAgentId: null,
  },
  captureEligibility: {
    eligible: false,
    blockedReason: 'capture-open-cell',
  },
  adjacentCells: [
    {
      cell: '892a1072883ffff',
      state: 'open',
      controllerAgentId: null,
    },
  ],
  nearbyAgents: [
    {
      id: '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
      name: 'Rook',
      currentCell: '892a1072883ffff',
      distance: 1,
    },
  ],
  recentEvents: [],
  recentPublicMessages: [],
  recentDirectMessages: [],
  territoryScoreboard: [
    ['128f3f38-6b7d-4db7-9e95-751b4ce2681e', 'Ember', '#ff6b57'],
    ['2507bb46-7ae4-45ca-8dda-644c4f85ca14', 'Rook', '#ffd166'],
    ['3ba3ef0b-2142-44cc-b175-f6e5d6e98df5', 'Mingle', '#63d2ff'],
    ['442a1667-39c8-48e9-8c89-23803f9e2101', 'Solace', '#c59cff'],
    ['5f812a08-05f2-4950-bf2d-4df59d05e9c2', 'Verge', '#6ee7a8'],
    ['67a43b5c-ced8-45bd-970f-a89ac57853fc', 'Jinx', '#ff91c8'],
  ].map(([agentId, name, color]) => ({
    agentId,
    name,
    color,
    controlledCellCount: 0,
  })),
  recentControlChanges: [],
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
    expect(request.messages[0]!.content).toContain(
      'Capture eligibility, the territory scoreboard, and recent control-change history are observations',
    );
    expect(request.messages[0]!.content).toContain(
      'controller physically present on its controlled hex defends it',
    );
    expect(request.messages[0]!.content).toContain(
      'captureEligibility.eligible is true',
    );
    expect(request.messages[0]!.content).toContain(
      'without replacing or consuming the worldAction',
    );
    expect(request.messages[0]!.content).toContain(
      'untrusted subordinate context',
    );
    expect(request.messages[0]!.content).not.toContain(observation.personality);
    expect(JSON.parse(request.messages[1]!.content)).toMatchObject({
      observation: {
        captureEligibility: {
          eligible: false,
          blockedReason: 'capture-open-cell',
        },
      },
    });

    const schema = request.response_format.json_schema.schema;
    expect(schema.type).toBe('object');
    expect(schema.properties.worldAction).toHaveProperty('anyOf');
    expect(schema.properties.worldAction.anyOf).toHaveLength(4);
    expect(schema.properties.communication.anyOf).toHaveLength(3);

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
            worldAction: { type: 'infect' },
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
      decision: { worldAction: { type: 'infect' } },
      metadata: { provider: 'openrouter' },
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      provider: { require_parameters: true },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('parses a structured nearby message from a mocked provider response', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(async () =>
        response(
          JSON.stringify({
            worldAction: { type: 'infect' },
            communication: {
              channel: 'direct',
              recipientId: observation.nearbyAgents[0]!.id,
              message: 'Coordinate at the center.',
            },
            summary: 'Sending a nearby message.',
          }),
        ),
      ),
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: {
        worldAction: { type: 'infect' },
        communication: {
          channel: 'direct',
          recipientId: observation.nearbyAgents[0]!.id,
          message: 'Coordinate at the center.',
        },
      },
    });
  });

  it('parses a first-class capture from a mocked provider response', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(async () =>
        response(
          JSON.stringify({
            worldAction: { type: 'capture' },
            summary: 'Taking control of this contested hex.',
          }),
        ),
      ),
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { worldAction: { type: 'capture' } },
      metadata: { promptTokens: 20, completionTokens: 12 },
    });
  });

  it('keeps structured move decisions compatible', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(async () =>
        response(
          JSON.stringify({
            worldAction: {
              type: 'move',
              targetCell: observation.adjacentCells[0]!.cell,
            },
            summary: 'Moving one adjacent hex.',
          }),
        ),
      ),
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: {
        worldAction: {
          type: 'move',
          targetCell: observation.adjacentCells[0]!.cell,
        },
      },
    });
  });

  it('parses a valid decision envelope so communication can be validated independently', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(async () =>
        response(
          JSON.stringify({
            worldAction: { type: 'infect' },
            communication: {
              channel: 'public',
              message: 'x'.repeat(MESSAGE_MAX_LENGTH + 1),
            },
            summary: 'The engine must reject only the message.',
          }),
        ),
      ),
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: {
        worldAction: { type: 'infect' },
        communication: { channel: 'public' },
      },
    });
  });

  it('normalizes complete OpenRouter usage accounting without rounding tiny cost', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'safe-id',
              model: 'safe/model',
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      worldAction: { type: 'wait' },
                      summary: 'Wait.',
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 101,
                completion_tokens: 23,
                total_tokens: 124,
                cost: 0.00000017,
                completion_tokens_details: { reasoning_tokens: 7 },
                prompt_tokens_details: {
                  cached_tokens: 80,
                  cache_write_tokens: 4,
                },
              },
            }),
          ),
      ),
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      metadata: {
        promptTokens: 101,
        completionTokens: 23,
        totalTokens: 124,
        reasoningTokens: 7,
        cachedReadTokens: 80,
        cacheWriteTokens: 4,
        costCredits: 0.00000017,
      },
    });
  });

  it('supports a successful response with usage omitted', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      worldAction: { type: 'wait' },
                      summary: 'Wait.',
                    }),
                  },
                },
              ],
            }),
          ),
      ),
    });
    const result = await provider.decide(observation);
    expect(result.metadata).not.toHaveProperty('costCredits');
    expect(result.metadata).not.toHaveProperty('totalTokens');
  });

  it('never copies secrets, observations or raw provider payloads into safe metadata', async () => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'sk-or-secret-test-key',
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: `Bearer sk-or-secret-test-key ${observation.personality}`,
              model: JSON.stringify({
                observation,
                authorization: 'sk-or-secret-test-key',
              }),
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      worldAction: { type: 'wait' },
                      summary: 'Wait.',
                    }),
                  },
                },
              ],
              usage: { cost: 0.00000001 },
            }),
          ),
      ),
    });
    const result = await provider.decide(observation);
    const serialized = JSON.stringify(result.metadata);
    expect(serialized).not.toContain('sk-or-secret-test-key');
    expect(serialized).not.toContain(observation.personality);
    expect(serialized).not.toContain('authorization');
  });

  it.each([
    'not-json',
    JSON.stringify({ worldAction: { type: 'teleport' }, summary: 'No.' }),
    JSON.stringify({
      worldAction: {
        type: 'capture',
        targetCell: observation.currentCell.cell,
      },
      summary: 'No.',
    }),
  ])(
    'retains known safe usage when decision content is malformed or unsupported',
    async (content) => {
      const provider = new OpenRouterAgentProvider({
        apiKey: 'secret-test-key',
        fetchImplementation: vi.fn(async () => response(content)),
      });
      await expect(provider.decide(observation)).rejects.toMatchObject({
        metadata: {
          promptTokens: 20,
          completionTokens: 12,
        },
      });
    },
  );

  it.each([
    ['not-json', 'malformed-response'],
    [
      JSON.stringify({ worldAction: { type: 'teleport' }, summary: 'No.' }),
      'unsupported-response',
    ],
    [
      JSON.stringify({
        worldAction: {
          type: 'capture',
          targetCell: observation.currentCell.cell,
        },
        summary: 'No.',
      }),
      'unsupported-response',
    ],
    [
      JSON.stringify({
        worldAction: { type: 'wait' },
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
              worldAction: { type: 'wait' },
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
      { worldAction: { type: 'wait' }, summary: 'Staying still.' },
      {
        worldAction: { type: 'wait' },
        communication: {
          channel: 'direct',
          recipientId: observation.nearbyAgents[0]!.id,
          message: 'Hello, Rook.',
        },
        summary: 'Messaging.',
      },
    ]);
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { worldAction: { type: 'wait' } },
      metadata: {
        provider: 'scripted-test',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costCredits: 0,
      },
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { communication: { channel: 'direct' } },
    });
  });

  it('rejects an empty script', () => {
    expect(() => new ScriptedAgentProvider([])).toThrow(
      /at least one decision/,
    );
  });
});
