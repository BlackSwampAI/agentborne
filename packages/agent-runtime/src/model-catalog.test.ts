import { describe, expect, it, vi } from 'vitest';
import {
  OPENROUTER_MODEL_CONTEXT_MINIMUM,
  OPENROUTER_REQUIRED_PARAMETERS,
} from '@agentborne/shared';
import {
  OpenRouterModelCatalog,
  sanitizeCompatibleModel,
} from './model-catalog';

const compatible = {
  id: 'author/compatible-model',
  name: 'Compatible Model',
  created: 1_700_000_000,
  context_length: OPENROUTER_MODEL_CONTEXT_MINIMUM,
  architecture: {
    input_modalities: ['text'],
    output_modalities: ['text'],
  },
  pricing: { prompt: '0.0000015', completion: '0.000004', request: '0' },
  supported_parameters: [...OPENROUTER_REQUIRED_PARAMETERS, 'temperature'],
  expiration_date: null,
  reasoning: {
    supported_efforts: ['high', 'low', 'minimal'],
    default_effort: 'low',
    default_enabled: true,
    mandatory: true,
  },
};

describe('OpenRouter model catalog', () => {
  it('sanitizes compatible models and safe decimal pricing', () => {
    expect(sanitizeCompatibleModel(compatible)).toMatchObject({
      id: compatible.id,
      author: 'author',
      contextLength: OPENROUTER_MODEL_CONTEXT_MINIMUM,
      inputPricePerToken: '0.0000015',
      outputPricePerToken: '0.000004',
      isFree: false,
      reasoning: {
        supportedEfforts: ['high', 'low', 'minimal'],
        mandatory: true,
      },
    });
    expect(
      sanitizeCompatibleModel({
        ...compatible,
        pricing: { ...compatible.pricing, prompt: 'not-a-price' },
      }),
    ).toBeUndefined();
  });

  it.each([
    ['max_tokens', { supported_parameters: ['tools', 'tool_choice'] }],
    ['tools', { supported_parameters: ['max_tokens', 'tool_choice'] }],
    ['tool_choice', { supported_parameters: ['max_tokens', 'tools'] }],
    ['context', { context_length: OPENROUTER_MODEL_CONTEXT_MINIMUM - 1 }],
    [
      'text output',
      {
        architecture: {
          input_modalities: ['text'],
          output_modalities: ['image'],
        },
      },
    ],
    [
      'text input',
      {
        architecture: {
          input_modalities: ['image'],
          output_modalities: ['text'],
        },
      },
    ],
  ])('excludes models missing required %s capability', (_label, change) => {
    expect(
      sanitizeCompatibleModel({ ...compatible, ...change }),
    ).toBeUndefined();
  });

  it('skips malformed entries and uses all remote defense-in-depth filters', async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('input_modalities')).toBe('text');
      expect(url.searchParams.get('output_modalities')).toBe('text');
      expect(url.searchParams.get('context')).toBe(
        String(OPENROUTER_MODEL_CONTEXT_MINIMUM),
      );
      expect(url.searchParams.get('supported_parameters')).toBe(
        OPENROUTER_REQUIRED_PARAMETERS.join(','),
      );
      return Response.json({ data: [compatible, { id: 42 }] });
    });
    const response = await new OpenRouterModelCatalog({
      apiKey: 'server-secret',
      fetchImplementation,
      now: () => 1_800_000_000_000,
    }).getCatalog();
    expect(response.models).toHaveLength(1);
    expect(response.filteredOutCount).toBe(1);
    expect(JSON.stringify(response)).not.toContain('server-secret');
  });

  it('caches successful results and preserves them as stale after refresh failure', async () => {
    let now = 1_800_000_000_000;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [compatible] }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const catalog = new OpenRouterModelCatalog({
      apiKey: 'server-secret',
      fetchImplementation,
      ttlMs: 1_000,
      now: () => now,
    });
    expect((await catalog.getCatalog()).stale).toBe(false);
    expect((await catalog.getCatalog()).models).toHaveLength(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    now += 2_000;
    const stale = await catalog.getCatalog(true);
    expect(stale.stale).toBe(true);
    expect(stale.models).toHaveLength(1);
    expect(stale.error?.code).toBe('provider-http');
  });

  it('returns safe configuration and timeout states without throwing', async () => {
    const missing = await new OpenRouterModelCatalog().getCatalog();
    expect(missing.error?.code).toBe('configuration');
    expect(missing.models).toEqual([]);

    const timedOut = await new OpenRouterModelCatalog({
      apiKey: 'server-secret',
      timeoutMs: 1,
      fetchImplementation: vi.fn(async (_input, init) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });
        return Response.json({ data: [] });
      }),
    }).getCatalog();
    expect(timedOut.error?.code).toBe('timeout');
  });
});
