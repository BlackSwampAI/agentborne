import { describe, expect, it } from 'vitest';
import {
  AgentProviderError,
  ScriptedAgentProvider,
  type AgentProvider,
  type ProviderDecision,
} from '@agentborne/agent-runtime';
import type { AgentObservation } from '@agentborne/shared';
import { SimulationConflictError, SimulationService } from './simulation-service';

const now = () => '2026-08-13T12:00:01.000Z';
const createEventId = () => '67aa21b9-fc78-4b04-9f92-9862bf346f96';

function service(provider: AgentProvider) {
  return new SimulationService({ provider, now, createEventId });
}

describe('SimulationService', () => {
  it('resets to the exact deterministic six-agent starting world', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    const initial = simulation.getSnapshot();
    await simulation.executeNextTurn();
    expect(simulation.reset()).toEqual(initial);
    expect(initial.world.agents).toHaveLength(6);
    expect(initial.world.hexes).toHaveLength(61);
  });

  it('calls the provider exactly once per turn in round-robin order', async () => {
    const seen: AgentObservation[] = [];
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'recording-test',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        seen.push(observation);
        return {
          decision: { requestedAction: { type: 'wait' }, summary: 'Wait.' },
          metadata: { provider: 'scripted-test', model: 'recording-test', latencyMs: 0 },
        };
      },
    };
    const simulation = service(provider);
    const order = simulation.getSnapshot().world.agents.map(({ id }) => id);
    for (let index = 0; index < 7; index += 1) await simulation.executeNextTurn();
    expect(seen).toHaveLength(7);
    expect(seen.map(({ agentId }) => agentId)).toEqual([...order, order[0]]);
  });

  it('builds each observation from the latest authoritative world state', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
        { requestedAction: { type: 'wait' }, summary: 'Observe.' },
      ]),
    );
    await simulation.executeNextTurn();
    const second = await simulation.executeNextTurn();
    expect(second.observation.recentEvents).toHaveLength(1);
    expect(second.observation.recentEvents[0]?.type).toBe('hex-infected');
  });

  it('records accepted and rejected actions without mutating on rejection', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { requestedAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    expect((await initial.executeNextTurn()).outcome).toBe('accepted');

    const rejected = service(
      new ScriptedAgentProvider([
        {
          requestedAction: { type: 'move', targetCell: '8928308280fffff' },
          summary: 'Attempt a distant move.',
        },
        { requestedAction: { type: 'wait' }, summary: 'Continue.' },
      ]),
    );
    const before = rejected.getSnapshot().world;
    expect((await rejected.executeNextTurn()).outcome).toBe('rejected');
    expect(rejected.getSnapshot().world.hexes).toEqual(before.hexes);
    expect(rejected.getSnapshot().world.agents).toEqual(before.agents);
    expect((await rejected.executeNextTurn()).outcome).toBe('accepted');
  });

  it('records a sanitized provider failure, preserves the world, and continues', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'failure-test',
      configured: true,
      async decide(): Promise<ProviderDecision> {
        calls += 1;
        if (calls === 1)
          throw new AgentProviderError({
            code: 'timeout',
            message: 'The model request timed out.',
            retryable: true,
          });
        return {
          decision: { requestedAction: { type: 'wait' }, summary: 'Recovered.' },
          metadata: { provider: 'scripted-test', model: 'failure-test', latencyMs: 0 },
        };
      },
    };
    const simulation = service(provider);
    const before = simulation.getSnapshot().world;
    expect((await simulation.executeNextTurn()).outcome).toBe('provider-error');
    expect(simulation.getSnapshot().world).toEqual(before);
    expect((await simulation.executeNextTurn()).outcome).toBe('accepted');
  });

  it('prevents overlapping turns and reset during an in-flight request', async () => {
    let release!: (result: ProviderDecision) => void;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'deferred-test',
      configured: true,
      decide: () => new Promise((resolve) => { release = resolve; }),
    };
    const simulation = service(provider);
    const pending = simulation.executeNextTurn();
    await expect(simulation.executeNextTurn()).rejects.toBeInstanceOf(SimulationConflictError);
    expect(() => simulation.reset()).toThrow(SimulationConflictError);
    release({
      decision: { requestedAction: { type: 'wait' }, summary: 'Done.' },
      metadata: { provider: 'scripted-test', model: 'deferred-test', latencyMs: 0 },
    });
    await pending;
    expect(simulation.getSnapshot().turnNumber).toBe(1);
  });
});
