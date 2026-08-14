import { describe, expect, it } from 'vitest';
import {
  MODEL_SUMMARY_MAX_LENGTH,
  agentDecisionSchema,
  agentObservationSchema,
  agentTurnRecordSchema,
  simulationSnapshotSchema,
} from '.';

const agentId = '128f3f38-6b7d-4db7-9e95-751b4ce2681e';
const cell = '892a1072893ffff';
const adjacent = '892a1072883ffff';
const observation = {
  agentId,
  agentName: 'Ember',
  personality: 'Prefer infection.',
  currentCell: { cell, state: 'open' },
  adjacentCells: [{ cell: adjacent, state: 'open' }],
  nearbyAgents: [],
  recentEvents: [],
};
const baseTurn = {
  turnNumber: 1,
  agentId,
  startedAt: '2026-08-13T12:00:00.000Z',
  completedAt: '2026-08-13T12:00:01.000Z',
  observation,
};
const provider = {
  provider: 'openrouter',
  model: 'openai/gpt-5-mini',
  latencyMs: 100,
};

describe('agent observation and decision schemas', () => {
  it('accepts a bounded state-bearing observation', () => {
    expect(agentObservationSchema.parse(observation).currentCell.state).toBe(
      'open',
    );
  });

  it.each([
    { ...observation, adjacentCells: [] },
    { ...observation, currentCell: { cell, state: 'unknown' } },
    {
      ...observation,
      nearbyAgents: Array(6).fill({
        id: agentId,
        name: 'x',
        currentCell: cell,
        distance: 1,
      }),
    },
  ])('rejects invalid or oversized observations', (value) => {
    expect(agentObservationSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    {
      requestedAction: { type: 'move', targetCell: adjacent },
      summary: 'Move.',
    },
    { requestedAction: { type: 'infect' }, summary: 'Infect.' },
    { requestedAction: { type: 'wait' }, summary: 'Wait.' },
  ])('accepts a PR 2 decision', (decision) => {
    expect(agentDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it.each([
    {
      requestedAction: { type: 'teleport', targetCell: adjacent },
      summary: 'No.',
    },
    {
      requestedAction: {
        type: 'message',
        recipientId: agentId,
        message: 'No.',
      },
      summary: 'No.',
    },
    {
      requestedAction: { type: 'wait' },
      summary: 'x'.repeat(MODEL_SUMMARY_MAX_LENGTH + 1),
    },
  ])('rejects forbidden actions and oversized model text', (decision) => {
    expect(agentDecisionSchema.safeParse(decision).success).toBe(false);
  });
});

describe('turn and snapshot schemas', () => {
  it.each([
    {
      ...baseTurn,
      outcome: 'accepted',
      requestedAction: { type: 'infect' },
      summary: 'Infect.',
      validation: { accepted: true },
      event: {
        id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
        agentId,
        occurredAt: '2026-08-13T12:00:01.000Z',
        type: 'hex-infected',
        cell,
      },
      provider,
    },
    {
      ...baseTurn,
      outcome: 'rejected',
      requestedAction: { type: 'move', targetCell: adjacent },
      summary: 'Move.',
      validation: { accepted: false, reason: 'not-adjacent', details: 'No.' },
      provider,
    },
    {
      ...baseTurn,
      outcome: 'provider-error',
      failure: { code: 'timeout', message: 'Timed out.', retryable: true },
    },
  ])('validates $outcome turn records', (turn) => {
    expect(agentTurnRecordSchema.safeParse(turn).success).toBe(true);
  });

  it('validates a complete API snapshot and rejects unbounded history', () => {
    const worldAgent = {
      id: agentId,
      name: 'Ember',
      color: '#ff6b57',
      personality: 'Prefer infection.',
      currentCell: cell,
    };
    const snapshot = {
      world: {
        generatedAt: '2026-08-13T12:00:00.000Z',
        hexes: [{ cell, state: 'open' }],
        agents: [worldAgent],
        events: [],
      },
      turnNumber: 0,
      nextAgentId: agentId,
      activeAgentId: null,
      status: 'paused',
      providerMode: 'openrouter',
      providerConfigured: true,
      turns: [],
    };
    expect(simulationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      simulationSnapshotSchema.safeParse({
        ...snapshot,
        turns: Array(121).fill({}),
      }).success,
    ).toBe(false);
  });
});
