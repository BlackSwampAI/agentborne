import { describe, expect, it, vi } from 'vitest';
import { agentObservationSchema } from '@agentborne/shared';
import {
  AgentProviderError,
  OpenRouterAgentProvider,
  ScriptedAgentProvider,
  buildOpenRouterRequest,
} from '.';

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
      model: 'openai/gpt-5-mini',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 20, completion_tokens: 12 },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('OpenRouterAgentProvider', () => {
  it('constructs a strict structured-output request with personality and observation data', () => {
    const request = buildOpenRouterRequest(observation);
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
    expect(request.provider).toEqual({ require_parameters: true });
    expect(request.messages[1].content).toContain(observation.personality);
    expect(request.messages[0].content).toContain('Never produce messages');
    expect(request.max_tokens).toBeLessThanOrEqual(200);
  });

  it('parses and runtime-validates a structured decision', async () => {
    const fetchImplementation = vi.fn(async () =>
      response(JSON.stringify({ requestedAction: { type: 'infect' }, summary: 'Claiming this cell.' })),
    );
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation,
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      decision: { requestedAction: { type: 'infect' } },
      metadata: { provider: 'openrouter' },
    });
    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      provider: { require_parameters: true },
    });
  });

  it.each([
    ['not-json', 'malformed-response'],
    [JSON.stringify({ requestedAction: { type: 'teleport' }, summary: 'No.' }), 'unsupported-response'],
    [JSON.stringify({ requestedAction: { type: 'wait' }, summary: 'x'.repeat(241) }), 'unsupported-response'],
  ])('rejects invalid provider content without fallback', async (content, code) => {
    const provider = new OpenRouterAgentProvider({
      apiKey: 'secret-test-key',
      fetchImplementation: vi.fn(async () => response(content)),
    });
    await expect(provider.decide(observation)).rejects.toMatchObject({
      failure: { code },
    });
  });

  it('sanitizes HTTP and network errors without leaking the key', async () => {
    const key = 'highly-sensitive-key';
    const httpProvider = new OpenRouterAgentProvider({
      apiKey: key,
      fetchImplementation: vi.fn(async () => response('{}', 500)),
    });
    const networkProvider = new OpenRouterAgentProvider({
      apiKey: key,
      fetchImplementation: vi.fn(async () => {
        throw new Error(`socket failed with ${key}`);
      }),
    });
    for (const provider of [httpProvider, networkProvider]) {
      try {
        await provider.decide(observation);
      } catch (error) {
        expect(error).toBeInstanceOf(AgentProviderError);
        expect(String(error)).not.toContain(key);
        expect(JSON.stringify(error)).not.toContain(key);
      }
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

  it('reports missing configuration instead of using a heuristic fallback', async () => {
    const provider = new OpenRouterAgentProvider();
    await expect(provider.decide(observation)).rejects.toMatchObject({
      failure: { code: 'configuration' },
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
    expect(() => new ScriptedAgentProvider([])).toThrow(/at least one decision/);
  });
});
