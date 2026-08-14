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
  resetSimulationResponseSchema,
  restoreDefaultPersonalitiesResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
  updateAgentPersonalityResponseSchema,
} from '@agentborne/shared';
import { createApp } from './app';

describe('game API simulation boundary', () => {
  it('reports health and serves a schema-valid snapshot', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { requestedAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    });
    expect((await app.request('/health')).status).toBe(200);
    const response = await app.request('/api/simulation');
    expect(response.status).toBe(200);
    const payload = simulationSnapshotSchema.parse(await response.json());
    expect(payload.world.agents).toHaveLength(6);
  });

  it('returns accepted and rejected single-turn records with valid response shapes', async () => {
    const acceptedApp = createApp({
      provider: new ScriptedAgentProvider([
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    });
    const accepted = singleTurnResponseSchema.parse(
      await (
        await acceptedApp.request('/api/simulation/turn', { method: 'POST' })
      ).json(),
    );
    expect(accepted.turn.outcome).toBe('accepted');

    const rejectedApp = createApp({
      provider: new ScriptedAgentProvider([
        {
          requestedAction: {
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
            model: 'google/gemini-3.7-flash',
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
          decision: { requestedAction: { type: 'wait' }, summary: 'Wait.' },
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
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
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
        { requestedAction: { type: 'wait' }, summary: 'Wait.' },
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
        { requestedAction: { type: 'wait' }, summary: 'Wait.' },
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
        { requestedAction: { type: 'wait' }, summary: 'Wait.' },
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
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
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
    release({
      decision: { requestedAction: { type: 'wait' }, summary: 'Done.' },
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
        { requestedAction: { type: 'wait' }, summary: 'Wait.' },
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
});
