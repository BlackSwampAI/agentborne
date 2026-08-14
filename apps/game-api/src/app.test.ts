import { describe, expect, it } from 'vitest';
import {
  AgentProviderError,
  OpenRouterAgentProvider,
  ScriptedAgentProvider,
  type AgentProvider,
  type ProviderDecision,
} from '@agentborne/agent-runtime';
import {
  resetSimulationResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
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
      await (await acceptedApp.request('/api/simulation/turn', { method: 'POST' })).json(),
    );
    expect(accepted.turn.outcome).toBe('accepted');

    const rejectedApp = createApp({
      provider: new ScriptedAgentProvider([
        {
          requestedAction: { type: 'move', targetCell: '8928308280fffff' },
          summary: 'Move far away.',
        },
      ]),
    });
    const rejected = singleTurnResponseSchema.parse(
      await (await rejectedApp.request('/api/simulation/turn', { method: 'POST' })).json(),
    );
    expect(rejected.turn.outcome).toBe('rejected');
  });

  it('returns provider failures and missing configuration safely', async () => {
    const failureProvider: AgentProvider = {
      mode: 'scripted-test',
      model: 'failure-test',
      configured: true,
      async decide() {
        throw new AgentProviderError({
          code: 'network',
          message: 'The model provider could not be reached.',
          retryable: true,
        });
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

    const missing = createApp({ provider: new OpenRouterAgentProvider() });
    const snapshot = simulationSnapshotSchema.parse(
      await (await missing.request('/api/simulation')).json(),
    );
    expect(snapshot).toMatchObject({
      status: 'configuration-error',
      providerConfigured: false,
    });
  });

  it('resets the complete simulation', async () => {
    const app = createApp({
      provider: new ScriptedAgentProvider([
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    });
    await app.request('/api/simulation/turn', { method: 'POST' });
    const response = await app.request('/api/simulation/reset', { method: 'POST' });
    const reset = resetSimulationResponseSchema.parse(await response.json());
    expect(reset.snapshot.turnNumber).toBe(0);
    expect(reset.snapshot.world.events).toEqual([]);
  });

  it('returns typed conflicts for an overlapping turn and reset', async () => {
    let release!: (result: ProviderDecision) => void;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'deferred-test',
      configured: true,
      decide: () => new Promise((resolve) => { release = resolve; }),
    };
    const app = createApp({ provider });
    const pending = app.request('/api/simulation/turn', { method: 'POST' });
    expect((await app.request('/api/simulation/turn', { method: 'POST' })).status).toBe(409);
    expect((await app.request('/api/simulation/reset', { method: 'POST' })).status).toBe(409);
    release({
      decision: { requestedAction: { type: 'wait' }, summary: 'Done.' },
      metadata: { provider: 'scripted-test', model: 'deferred-test', latencyMs: 0 },
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
