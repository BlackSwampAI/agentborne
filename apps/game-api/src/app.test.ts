import { describe, expect, it } from 'vitest';
import {
  AgentProviderError,
  OpenRouterAgentProvider,
  ScriptedAgentProvider,
  type AgentProvider,
  type ProviderDecision,
} from '@agentborne/agent-runtime';
import {
  h3CellSchema,
  experimentExportPreviewSchema,
  experimentExportResponseSchema,
  healthResponseSchema,
  modelCatalogResponseSchema,
  resetSimulationResponseSchema,
  restoreDefaultPersonalitiesResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
  updateAgentPersonalityResponseSchema,
  updateExperimentModelsResponseSchema,
  verifyModelResponseSchema,
} from '@agentborne/shared';
import { createApp } from './app';

describe('game API simulation boundary', () => {
  it('reports health and serves a schema-valid snapshot', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(healthResponseSchema.parse(await health.json()).status).toBe('ok');
    const response = await app.request('/api/simulation');
    expect(response.status).toBe(200);
    const payload = simulationSnapshotSchema.parse(await response.json());
    expect(payload.world.agents).toHaveLength(8);
    expect(
      payload.world.hexes.every(
        (hex) => hex.state === 'open' && hex.controllerAgentId === null,
      ),
    ).toBe(true);
    expect(payload.experiment.currentTerritory).toHaveLength(8);
  });

  it('serves and refreshes sanitized catalogs without exposing the server key', async () => {
    const secret = 'server-only-secret-marker';
    const forced: boolean[] = [];
    const catalogResponse = modelCatalogResponseSchema.parse({
      models: [
        {
          id: 'example/compatible-model',
          name: 'Compatible model',
          author: 'example',
          contextLength: 32_768,
          inputPricePerToken: '0.000001',
          outputPricePerToken: '0.000002',
          supportedParameters: ['max_tokens', 'tools', 'tool_choice'],
          isFree: false,
        },
      ],
      filteredOutCount: 4,
      stale: false,
      requirements: {
        input: 'text',
        output: 'text',
        endpoint: 'chat-completions',
        requiredParameters: ['max_tokens', 'tools', 'tool_choice'],
        minimumContextLength: 16_384,
        streaming: false,
      },
    });
    const app = createApp({
      provider: new OpenRouterAgentProvider({ apiKey: secret }),
      catalog: {
        async getCatalog(force = false) {
          forced.push(force);
          return catalogResponse;
        },
      },
    });
    const catalog = await (await app.request('/api/simulation/models')).json();
    expect(modelCatalogResponseSchema.parse(catalog).models).toHaveLength(1);
    const assigned = updateExperimentModelsResponseSchema.parse(
      await (
        await app.request('/api/simulation/experiment/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            globalModelId: 'example/compatible-model',
            overrides: [],
          }),
        })
      ).json(),
    );
    expect(
      assigned.snapshot.resolvedModels.every(({ available }) => available),
    ).toBe(true);
    const refreshed = await (
      await app.request('/api/simulation/models/refresh', { method: 'POST' })
    ).json();
    expect(forced).toEqual([false, false, true]);
    expect(JSON.stringify({ catalog, assigned, refreshed })).not.toContain(
      secret,
    );
  });

  it('caches an explicit model probe without advancing the world', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      mode: 'openrouter',
      configured: true,
      async decide(_observation, model) {
        calls += 1;
        return {
          decision: { worldAction: { type: 'wait' }, summary: 'Probe.' },
          metadata: { provider: 'openrouter', model, latencyMs: 1 },
        };
      },
    };
    const catalogResponse = modelCatalogResponseSchema.parse({
      models: [
        {
          id: 'example/probe-model',
          name: 'Probe model',
          author: 'example',
          contextLength: 16_384,
          inputPricePerToken: '0',
          outputPricePerToken: '0',
          supportedParameters: ['max_tokens', 'tools', 'tool_choice'],
          isFree: true,
        },
      ],
      filteredOutCount: 0,
      stale: false,
      requirements: {
        input: 'text',
        output: 'text',
        endpoint: 'chat-completions',
        requiredParameters: ['max_tokens', 'tools', 'tool_choice'],
        minimumContextLength: 16_384,
        streaming: false,
      },
    });
    const app = createApp({
      provider,
      catalog: {
        async getCatalog() {
          return catalogResponse;
        },
      },
    });
    const before = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );
    for (let index = 0; index < 2; index += 1) {
      const response = await app.request('/api/simulation/models/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: 'example/probe-model' }),
      });
      expect(
        verifyModelResponseSchema.parse(await response.json()).verification
          .status,
      ).toBe('verified');
    }
    const after = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );
    expect(calls).toBe(1);
    expect(after.world).toEqual(before.world);
    expect(after.turnNumber).toBe(0);
  });

  it('returns accepted and rejected single-turn records with valid response shapes', async () => {
    const acceptedApp = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    });
    const accepted = singleTurnResponseSchema.parse(
      await (
        await acceptedApp.request('/api/simulation/turn', { method: 'POST' })
      ).json(),
    );
    expect(accepted.turn.outcome).toBe('accepted');
    if (accepted.turn.outcome !== 'accepted')
      throw new Error('Expected accepted infection fixture.');
    expect(accepted.turn).toMatchObject({
      worldActionResult: {
        event: {
          type: 'hex-infected',
          controllerAgentId: accepted.turn.agentId,
        },
      },
    });
    expect(
      accepted.snapshot.world.hexes.find(
        ({ cell }) => cell === accepted.turn.observation.currentCell.cell,
      ),
    ).toMatchObject({
      state: 'infected',
      controllerAgentId: accepted.turn.agentId,
    });

    const rejectedApp = createApp({
      provider: new ScriptedAgentProvider([
        {
          worldAction: {
            type: 'move',
            targetCell: h3CellSchema.parse('8928308280fffff'),
          },
          summary: 'Move far away.',
        },
      ]),
    });
    const rejected = singleTurnResponseSchema.parse(
      await (
        await rejectedApp.request('/api/simulation/turn', { method: 'POST' })
      ).json(),
    );
    expect(rejected.turn.outcome).toBe('rejected');
  });

  it('returns independently typed world-action and communication responses', async () => {
    const bootstrap = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    });
    const snapshot = simulationSnapshotSchema.parse(
      await (await bootstrap.request('/api/simulation')).json(),
    );
    const [sender, recipient] = snapshot.world.agents;
    const acceptedApp = createApp({
      provider: new ScriptedAgentProvider([
        {
          worldAction: { type: 'wait' },
          communication: {
            channel: 'direct',
            recipientId: recipient!.id,
            message: 'Nearby API message.',
          },
          summary: 'Send.',
        },
      ]),
    });
    const accepted = singleTurnResponseSchema.parse(
      await (
        await acceptedApp.request('/api/simulation/turn', { method: 'POST' })
      ).json(),
    );
    expect(accepted.turn).toMatchObject({
      outcome: 'accepted',
      communicationResult: {
        accepted: true,
        event: {
          type: 'direct-message-sent',
          agentId: sender!.id,
          recipientId: recipient!.id,
          message: 'Nearby API message.',
        },
      },
    });

    const rejectedApp = createApp({
      provider: new ScriptedAgentProvider([
        {
          worldAction: { type: 'wait' },
          communication: {
            channel: 'direct',
            recipientId: sender!.id,
            message: 'Self message.',
          },
          summary: 'Try.',
        },
      ]),
    });
    const rejected = singleTurnResponseSchema.parse(
      await (
        await rejectedApp.request('/api/simulation/turn', { method: 'POST' })
      ).json(),
    );
    expect(rejected.turn).toMatchObject({
      outcome: 'accepted',
      communicationResult: { accepted: false, reason: 'self-message' },
    });
    expect(rejected.snapshot.world.events).toHaveLength(1);
  });

  it('returns provider failures and missing configuration safely', async () => {
    const failureProvider: AgentProvider = {
      mode: 'scripted-test',
      model: 'failure-test',
      configured: true,
      async decide() {
        throw new AgentProviderError(
          {
            code: 'network',
            message: 'The model provider could not be reached.',
            retryable: true,
          },
          undefined,
          {
            httpStatus: 400,
            providerMessage: 'internal-diagnostic-marker',
            model: 'example/compatible-model',
          },
        );
      },
    };
    const failed = singleTurnResponseSchema.parse(
      await (
        await createApp({ provider: failureProvider }).request(
          '/api/simulation/turn',
          { method: 'POST' },
        )
      ).json(),
    );
    expect(failed.turn.outcome).toBe('provider-error');
    expect(JSON.stringify(failed)).not.toContain('internal-diagnostic-marker');

    const missing = createApp({ provider: new OpenRouterAgentProvider() });
    const snapshot = simulationSnapshotSchema.parse(
      await (await missing.request('/api/simulation')).json(),
    );
    expect(snapshot).toMatchObject({
      status: 'configuration-error',
      providerConfigured: false,
    });
  });

  it('returns internal errors for post-provider validation failures without advancing', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'invalid-metadata-test',
      configured: true,
      async decide(): Promise<ProviderDecision> {
        calls += 1;
        return {
          decision: { worldAction: { type: 'wait' }, summary: 'Wait.' },
          metadata: {
            provider: 'scripted-test',
            model: calls === 1 ? '' : 'invalid-metadata-test',
            latencyMs: 0,
          },
        } as ProviderDecision;
      },
    };
    const app = createApp({ provider });
    const initial = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );

    const failed = await app.request('/api/simulation/turn', {
      method: 'POST',
    });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      },
    });

    const afterFailure = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );
    expect(afterFailure).toMatchObject({
      turnNumber: 0,
      turns: [],
      nextAgentId: initial.nextAgentId,
      activeAgentId: null,
      status: 'paused',
    });
    expect(afterFailure.world).toEqual(initial.world);

    const recovered = singleTurnResponseSchema.parse(
      await (
        await app.request('/api/simulation/turn', { method: 'POST' })
      ).json(),
    );
    expect(recovered.turn).toMatchObject({
      turnNumber: 1,
      agentId: initial.nextAgentId,
      outcome: 'accepted',
    });
  });

  it('resets world progress while preserving personality configuration', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    });
    const initial = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );
    await app.request(
      `/api/simulation/agents/${initial.world.agents[0]!.id}/personality`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality: 'Preserved through reset.' }),
      },
    );
    await app.request('/api/simulation/turn', { method: 'POST' });
    const response = await app.request('/api/simulation/reset', {
      method: 'POST',
    });
    const reset = resetSimulationResponseSchema.parse(await response.json());
    expect(reset.snapshot.turnNumber).toBe(0);
    expect(reset.snapshot.world.events).toEqual([]);
    expect(reset.snapshot.world.agents[0]!.personality).toBe(
      'Preserved through reset.',
    );
  });

  it('updates one agent personality through a runtime-validated safe response', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    const initial = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );
    const agent = initial.world.agents[0]!;
    const response = await app.request(
      `/api/simulation/agents/${agent.id}/personality`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality: '  Explore open edges.  ' }),
      },
    );
    expect(response.status).toBe(200);
    const payload = updateAgentPersonalityResponseSchema.parse(
      await response.json(),
    );
    expect(payload.agent.personality).toBe('Explore open edges.');
    expect(payload.snapshot.world.agents[0]!.personality).toBe(
      'Explore open edges.',
    );
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key|secret|prompt/i);
  });

  it.each([
    JSON.stringify({ personality: '' }),
    JSON.stringify({ personality: 42 }),
    '{malformed',
  ])('rejects invalid personality request bodies safely', async (body) => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    const response = await app.request(
      '/api/simulation/agents/128f3f38-6b7d-4db7-9e95-751b4ce2681e/personality',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_personality',
        message: 'Personality must contain 1 to 600 characters.',
      },
    });
  });

  it('returns typed invalid and unknown agent errors without internal details', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    for (const [agentId, status, code] of [
      ['not-a-uuid', 400, 'invalid_agent_id'],
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 404, 'unknown_agent'],
    ] as const) {
      const response = await app.request(
        `/api/simulation/agents/${agentId}/personality`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personality: 'Valid request.' }),
        },
      );
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code } });
      expect(JSON.stringify(body)).not.toMatch(
        /stack|provider|openrouter|secret/i,
      );
    }
  });

  it('restores all default personalities without resetting progress', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    });
    const initial = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    );
    const agent = initial.world.agents[0]!;
    await app.request(`/api/simulation/agents/${agent.id}/personality`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personality: 'Custom.' }),
    });
    await app.request('/api/simulation/turn', { method: 'POST' });

    const response = await app.request(
      '/api/simulation/personalities/restore-defaults',
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    const restored = restoreDefaultPersonalitiesResponseSchema.parse(
      await response.json(),
    );
    expect(restored.snapshot.turnNumber).toBe(1);
    expect(restored.snapshot.world.events).toHaveLength(1);
    expect(restored.snapshot.world.agents[0]!.personality).toBe(
      agent.personality,
    );
    expect(
      restored.snapshot.world.agents.find(({ name }) => name === 'Mingle')
        ?.personality,
    ).toBe(
      'You are a social coalition-builder. Seek agents, initiate and continue conversations, propose alliances, answer offers, negotiate borders, and coordinate captures against dominant rivals. Prefer cooperation and public diplomacy over silent expansion, but protect your own territory and leave an alliance that repeatedly ignores or exploits you. Make concrete proposals rather than merely announcing actions.',
    );
  });

  it('returns typed conflicts for an overlapping turn and reset', async () => {
    let release!: (result: ProviderDecision) => void;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'deferred-test',
      configured: true,
      decide: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const app = createApp({ provider });
    const pending = app.request('/api/simulation/turn', { method: 'POST' });
    expect(
      (await app.request('/api/simulation/turn', { method: 'POST' })).status,
    ).toBe(409);
    expect(
      (await app.request('/api/simulation/reset', { method: 'POST' })).status,
    ).toBe(409);
    const agentId = simulationSnapshotSchema.parse(
      await (await app.request('/api/simulation')).json(),
    ).world.agents[0]!.id;
    const editConflict = await app.request(
      `/api/simulation/agents/${agentId}/personality`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality: 'Blocked.' }),
      },
    );
    expect(editConflict.status).toBe(409);
    await expect(editConflict.json()).resolves.toMatchObject({
      error: { code: 'personality_conflict' },
    });
    const restoreConflict = await app.request(
      '/api/simulation/personalities/restore-defaults',
      { method: 'POST' },
    );
    expect(restoreConflict.status).toBe(409);
    await expect(restoreConflict.json()).resolves.toMatchObject({
      error: { code: 'personality_conflict' },
    });
    const exportConflict = await app.request(
      '/api/simulation/experiment/export/preview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: { mode: 'all' },
          turns: { mode: 'entire-retained' },
          outcomes: ['accepted'],
          actions: ['wait'],
          level: 'minimal',
        }),
      },
    );
    expect(exportConflict.status).toBe(409);
    await expect(exportConflict.json()).resolves.toMatchObject({
      error: { code: 'export_conflict' },
    });
    release({
      decision: { worldAction: { type: 'wait' }, summary: 'Done.' },
      metadata: {
        provider: 'scripted-test',
        model: 'deferred-test',
        latencyMs: 0,
      },
    });
    expect((await pending).status).toBe(200);
  });

  it('uses a predictable error envelope', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    const response = await app.request('/missing');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'The requested route does not exist.',
      },
    });
  });

  it('previews and generates schema-valid retained exports through narrow endpoints', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    await app.request('/api/simulation/turn', { method: 'POST' });
    const request = {
      agents: { mode: 'all' },
      turns: { mode: 'entire-retained' },
      outcomes: ['accepted', 'rejected', 'provider-error'],
      actions: ['move', 'infect', 'capture', 'wait'],
      level: 'minimal',
    };
    const previewResponse = await app.request(
      '/api/simulation/experiment/export/preview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview = experimentExportPreviewSchema.parse(
      await previewResponse.json(),
    );
    expect(preview).toMatchObject({
      matchingTurnCount: 1,
      knownCostCredits: 0,
      turnsWithUnknownCost: 0,
    });
    const generatedResponse = await app.request(
      '/api/simulation/experiment/export',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
    const generated = experimentExportResponseSchema.parse(
      await generatedResponse.json(),
    );
    expect(
      generated.document.turns.map(({ turnNumber }) => turnNumber),
    ).toEqual([1]);
    expect(JSON.stringify(generated)).not.toMatch(
      /authorization|api[_-]?key|rawPrompt|rawBody|chainOfThought|privateReasoning/i,
    );
  });

  it.each([
    [{}, 400, 'invalid_export'],
    [
      {
        agents: { mode: 'selected', agentIds: [] },
        turns: { mode: 'entire-retained' },
        outcomes: ['accepted'],
        actions: ['wait'],
        level: 'minimal',
      },
      400,
      'invalid_export',
    ],
    [
      {
        agents: {
          mode: 'selected',
          agentIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        },
        turns: { mode: 'entire-retained' },
        outcomes: ['accepted'],
        actions: ['wait'],
        level: 'minimal',
      },
      404,
      'unknown_agent',
    ],
  ])(
    'returns typed safe export validation failures',
    async (body, status, code) => {
      const app = createApp({
        provider: new ScriptedAgentProvider([
          { worldAction: { type: 'wait' }, summary: 'Wait.' },
        ]),
      });
      const response = await app.request('/api/simulation/experiment/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    },
  );
});
