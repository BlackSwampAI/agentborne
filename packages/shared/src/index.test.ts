import { describe, expect, it } from 'vitest';
import {
  MODEL_SUMMARY_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  PERSONALITY_MAX_LENGTH,
  apiErrorSchema,
  agentDecisionSchema,
  agentObservationSchema,
  agentTurnRecordSchema,
  directMessageEventSchema,
  captureEligibilitySchema,
  experimentExportWorldStateSchema,
  hexCapturedWorldEventSchema,
  hexSchema,
  invalidActionReasonSchema,
  experimentExportRequestSchema,
  experimentIdSchema,
  personalityConfigurationEventSchema,
  providerMetadataSchema,
  restoreDefaultPersonalitiesResponseSchema,
  simulationSnapshotSchema,
  updateAgentPersonalityRequestSchema,
  updateAgentPersonalityResponseSchema,
} from '.';

const agentId = '128f3f38-6b7d-4db7-9e95-751b4ce2681e';
const cell = '892a1072893ffff';
const adjacent = '892a1072883ffff';
const scoreboard = [
  '128f3f38-6b7d-4db7-9e95-751b4ce2681e',
  '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
  '3ba3ef0b-2142-44cc-b175-f6e5d6e98df5',
  '442a1667-39c8-48e9-8c89-23803f9e2101',
  '5f812a08-05f2-4950-bf2d-4df59d05e9c2',
  '67a43b5c-ced8-45bd-970f-a89ac57853fc',
].map((id, index) => ({
  agentId: id,
  name: `Agent ${index + 1}`,
  color: '#ff6b57',
  controlledCellCount: 0,
}));
const observation = {
  agentId,
  agentName: 'Ember',
  personality: 'Prefer infection.',
  currentCell: { cell, state: 'open', controllerAgentId: null },
  captureEligibility: {
    eligible: false,
    blockedReason: 'capture-open-cell',
  },
  adjacentCells: [{ cell: adjacent, state: 'open', controllerAgentId: null }],
  nearbyAgents: [],
  recentEvents: [],
  recentPublicMessages: [],
  recentDirectMessages: [],
  territoryScoreboard: scoreboard,
  recentControlChanges: [],
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
  model: 'google/gemini-3.7-flash',
  latencyMs: 100,
};
const event = {
  id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
  agentId,
  occurredAt: '2026-08-13T12:00:01.000Z',
  type: 'hex-infected',
  cell,
  controllerAgentId: agentId,
};
const worldAgent = {
  id: agentId,
  name: 'Ember',
  color: '#ff6b57',
  personality: 'Prefer infection.',
  currentCell: cell,
};
const worldAgents = scoreboard.map((entry) => ({
  id: entry.agentId,
  name: entry.name,
  color: entry.color,
  personality: 'Prefer infection.',
  currentCell: cell,
}));
const snapshot = {
  world: {
    generatedAt: '2026-08-13T12:00:00.000Z',
    hexes: [{ cell, state: 'open', controllerAgentId: null }],
    agents: worldAgents,
    events: [],
  },
  turnNumber: 0,
  nextAgentId: agentId,
  activeAgentId: null,
  status: 'paused',
  providerMode: 'openrouter',
  providerConfigured: true,
  turns: [],
  experiment: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    startedAt: '2026-08-13T12:00:00.000Z',
    totalCompletedTurns: 0,
    retainedTurns: 0,
    droppedRecords: 0,
    complete: true,
    metrics: {
      aggregate: {
        totalTurns: 0,
        accepted: 0,
        rejected: 0,
        providerErrors: 0,
        requestedMoves: 0,
        requestedInfections: 0,
        requestedCaptures: 0,
        requestedWaits: 0,
        acceptedMovements: 0,
        successfullyInfectedCells: 0,
        successfulCaptures: 0,
        acceptedWaits: 0,
        rejectedWorldActions: 0,
        territoryGainedThroughInfection: 0,
        territoryGainedThroughCapture: 0,
        territoryLostThroughCapture: 0,
        publicMessagesRequested: 0,
        publicMessagesAccepted: 0,
        publicMessagesRejected: 0,
        directMessagesRequested: 0,
        directMessagesDelivered: 0,
        directMessagesRejected: 0,
        publicMessagesSent: 0,
        directMessagesSent: 0,
        directMessagesReceived: 0,
        uniqueVisitedCells: 0,
        tokens: {},
        knownCostCredits: 0,
        turnsWithUnknownCost: 0,
      },
      byAgent: [],
    },
    currentTerritory: scoreboard,
  },
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
      worldAction: { type: 'move', targetCell: adjacent },
      summary: 'Move.',
    },
    { worldAction: { type: 'infect' }, summary: 'Infect.' },
    { worldAction: { type: 'capture' }, summary: 'Capture.' },
    {
      worldAction: { type: 'wait' },
      communication: {
        channel: 'direct',
        recipientId: '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
        message: 'Coordinate here.',
      },
      summary: 'Message.',
    },
    { worldAction: { type: 'wait' }, summary: 'Wait.' },
  ])(
    'accepts every supported world action and optional communication',
    (decision) => {
      expect(agentDecisionSchema.safeParse(decision).success).toBe(true);
    },
  );

  it('validates explicit hex control invariants and capture events', () => {
    expect(
      hexSchema.safeParse({ cell, state: 'open', controllerAgentId: null })
        .success,
    ).toBe(true);
    expect(
      hexSchema.safeParse({
        cell,
        state: 'infected',
        controllerAgentId: agentId,
      }).success,
    ).toBe(true);
    expect(
      hexSchema.safeParse({ cell, state: 'open', controllerAgentId: agentId })
        .success,
    ).toBe(false);
    expect(
      hexSchema.safeParse({ cell, state: 'infected', controllerAgentId: null })
        .success,
    ).toBe(false);
    expect(
      hexCapturedWorldEventSchema.safeParse({
        id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
        type: 'hex-captured',
        agentId,
        controllerAgentId: agentId,
        previousControllerAgentId: '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
        cell,
        occurredAt: '2026-08-13T12:00:01.000Z',
      }).success,
    ).toBe(true);
    expect(invalidActionReasonSchema.parse('capture-open-cell')).toBe(
      'capture-open-cell',
    );
    expect(invalidActionReasonSchema.parse('already-controller')).toBe(
      'already-controller',
    );
    expect(invalidActionReasonSchema.parse('controller-present')).toBe(
      'controller-present',
    );
    expect(captureEligibilitySchema.parse({ eligible: true })).toEqual({
      eligible: true,
    });
    for (const blockedReason of [
      'capture-open-cell',
      'already-controller',
      'controller-present',
    ] as const) {
      expect(
        captureEligibilitySchema.parse({ eligible: false, blockedReason }),
      ).toEqual({ eligible: false, blockedReason });
    }
    expect(
      captureEligibilitySchema.safeParse({
        eligible: false,
        blockedReason: 'some-other-reason',
      }).success,
    ).toBe(false);
    expect(
      simulationSnapshotSchema.safeParse({
        ...snapshot,
        world: {
          ...snapshot.world,
          hexes: [
            {
              cell,
              state: 'infected',
              controllerAgentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      worldAction: { type: 'teleport', targetCell: adjacent },
      summary: 'No.',
    },
    {
      worldAction: { type: 'wait' },
      summary: 'x'.repeat(MODEL_SUMMARY_MAX_LENGTH + 1),
    },
  ])('rejects forbidden actions and oversized model text', (decision) => {
    expect(agentDecisionSchema.safeParse(decision).success).toBe(false);
  });

  it('trims message content and enforces recipient and 280-character boundaries', () => {
    const recipientId = '2507bb46-7ae4-45ca-8dda-644c4f85ca14';
    const parsed = agentDecisionSchema.parse({
      worldAction: { type: 'wait' },
      communication: {
        channel: 'direct',
        recipientId,
        message: `  ${'x'.repeat(MESSAGE_MAX_LENGTH)}  `,
      },
      summary: 'Send.',
    });
    expect(parsed.communication).toMatchObject({
      channel: 'direct',
      message: 'x'.repeat(MESSAGE_MAX_LENGTH),
    });
    for (const communication of [
      { channel: 'direct', recipientId, message: '   ' },
      {
        channel: 'direct',
        recipientId,
        message: 'x'.repeat(MESSAGE_MAX_LENGTH + 1),
      },
      { channel: 'direct', recipientId: 'not-an-agent', message: 'Hello.' },
    ])
      expect(
        agentDecisionSchema.safeParse({
          worldAction: { type: 'wait' },
          communication,
          summary: 'Send.',
        }).success,
      ).toBe(false);
  });

  it('validates typed messages and caps directional conversation context at six', () => {
    const recipientId = '2507bb46-7ae4-45ca-8dda-644c4f85ca14';
    const messageEvent = directMessageEventSchema.parse({
      id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
      type: 'direct-message-sent',
      channel: 'direct',
      agentId,
      recipientId,
      occurredAt: '2026-08-13T12:00:01.000Z',
      message: 'Hello.',
      distance: 3,
    });
    const communication = {
      eventId: messageEvent.id,
      senderId: agentId,
      senderName: 'Ember',
      recipientId,
      recipientName: 'Rook',
      direction: 'outbound',
      message: messageEvent.message,
      occurredAt: messageEvent.occurredAt,
      distance: messageEvent.distance,
    };
    expect(
      agentObservationSchema.safeParse({
        ...observation,
        recentPublicMessages: [],
        recentDirectMessages: Array(6).fill(communication),
      }).success,
    ).toBe(true);
    expect(
      agentObservationSchema.safeParse({
        ...observation,
        recentPublicMessages: [],
        recentDirectMessages: Array(7).fill(communication),
      }).success,
    ).toBe(false);
  });

  it('caps public context at twelve and accepts one-character public text', () => {
    const publicMessage = {
      eventId: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
      senderId: agentId,
      senderName: 'Ember',
      message: 'x',
      occurredAt: '2026-08-13T12:00:01.000Z',
    };
    expect(
      agentDecisionSchema.safeParse({
        worldAction: { type: 'wait' },
        communication: { channel: 'public', message: ' x ' },
        summary: 'Publish.',
      }).success,
    ).toBe(true);
    expect(
      agentObservationSchema.safeParse({
        ...observation,
        recentPublicMessages: Array(12).fill(publicMessage),
      }).success,
    ).toBe(true);
    expect(
      agentObservationSchema.safeParse({
        ...observation,
        recentPublicMessages: Array(13).fill(publicMessage),
      }).success,
    ).toBe(false);
  });

  it('caps chronological gained/lost control observations at six', () => {
    const change = {
      eventId: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
      direction: 'gained',
      otherAgentId: '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
      otherAgentName: 'Rook',
      cell,
      occurredAt: '2026-08-13T12:00:01.000Z',
    };
    expect(
      agentObservationSchema.safeParse({
        ...observation,
        recentControlChanges: Array(6).fill(change),
      }).success,
    ).toBe(true);
    expect(
      agentObservationSchema.safeParse({
        ...observation,
        recentControlChanges: Array(7).fill(change),
      }).success,
    ).toBe(false);
  });
});

describe('turn and snapshot schemas', () => {
  it('validates state-only export snapshots without dropping controller invariants', () => {
    const worldState = {
      generatedAt: snapshot.world.generatedAt,
      hexes: snapshot.world.hexes,
      agents: snapshot.world.agents,
    };
    expect(experimentExportWorldStateSchema.safeParse(worldState).success).toBe(
      true,
    );
    expect(
      experimentExportWorldStateSchema.safeParse({
        ...worldState,
        hexes: [
          {
            cell,
            state: 'infected',
            controllerAgentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      ...baseTurn,
      outcome: 'accepted',
      worldAction: { type: 'infect' },
      summary: 'Infect.',
      worldActionResult: { accepted: true, event },
      communicationResult: { requested: false },
      provider,
    },
    {
      ...baseTurn,
      outcome: 'rejected',
      worldAction: { type: 'move', targetCell: adjacent },
      summary: 'Move.',
      worldActionResult: {
        accepted: false,
        reason: 'not-adjacent',
        details: 'No.',
      },
      communicationResult: { requested: false },
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

  it('validates a complete API snapshot and rejects unbounded histories', () => {
    const validTurn = {
      ...baseTurn,
      outcome: 'accepted',
      worldAction: { type: 'infect' },
      summary: 'Infect.',
      worldActionResult: { accepted: true, event },
      communicationResult: { requested: false },
      provider,
    };
    expect(simulationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      simulationSnapshotSchema.safeParse({
        ...snapshot,
        turns: Array(121).fill(validTurn),
      }).success,
    ).toBe(false);
    expect(
      simulationSnapshotSchema.safeParse({
        ...snapshot,
        world: {
          ...snapshot.world,
          events: Array(121).fill(event),
        },
      }).success,
    ).toBe(false);
  });
});

describe('experiment telemetry and export contracts', () => {
  it('accepts complete, partial and tiny-cost provider usage without fabricating unknowns', () => {
    expect(
      providerMetadataSchema.parse({
        ...provider,
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
        reasoningTokens: 1,
        cachedReadTokens: 8,
        cacheWriteTokens: 2,
        costCredits: 0.00000001,
      }).costCredits,
    ).toBe(0.00000001);
    expect(providerMetadataSchema.parse(provider)).not.toHaveProperty(
      'costCredits',
    );
  });

  it('validates experiment identities and immutable configuration events', () => {
    expect(experimentIdSchema.safeParse('not-an-id').success).toBe(false);
    expect(
      personalityConfigurationEventSchema.safeParse({
        timestamp: '2026-08-13T12:00:00.000Z',
        agentId,
        previousPersonality: 'Before.',
        newPersonality: 'After.',
        operation: 'custom-edit',
      }).success,
    ).toBe(true);
  });

  it('validates all levels and rejects empty, malformed, duplicate and inverted selections', () => {
    const base = {
      agents: { mode: 'selected', agentIds: [agentId] },
      turns: { mode: 'entire-retained' },
      outcomes: ['accepted'],
      actions: ['capture', 'wait'],
      communications: { channel: 'all', status: 'all' },
    };
    for (const level of ['minimal', 'standard', 'full-safe'])
      expect(
        experimentExportRequestSchema.safeParse({ ...base, level }).success,
      ).toBe(true);
    expect(
      experimentExportRequestSchema.parse({ ...base, level: 'minimal' })
        .serialization,
    ).toBe('compact');
    expect(
      experimentExportRequestSchema.safeParse({
        ...base,
        level: 'minimal',
        serialization: 'pretty',
      }).success,
    ).toBe(true);
    expect(
      experimentExportRequestSchema.safeParse({
        ...base,
        level: 'custom',
        custom: {
          turnObservations: false,
          personalityTextHistory: false,
          nearbyAgents: false,
          recentEvents: false,
          recentPublicMessages: false,
          recentDirectMessages: false,
          recentControlChanges: false,
          validationDetails: false,
          resultingEvents: false,
          providerUsageMetadata: false,
          initialWorldState: false,
          currentWorldState: false,
          computedMetrics: false,
          communications: true,
          controlChanges: true,
        },
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...base, agents: { mode: 'selected', agentIds: [] }, level: 'minimal' },
      { ...base, outcomes: [], level: 'minimal' },
      { ...base, actions: [], level: 'minimal' },
      {
        ...base,
        turns: { mode: 'range', fromTurn: 9, toTurn: 2 },
        level: 'minimal',
      },
      {
        ...base,
        agents: { mode: 'selected', agentIds: ['bad-id'] },
        level: 'minimal',
      },
    ])
      expect(experimentExportRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
});

describe('personality mutation contracts', () => {
  it('trims a valid update and validates its response', () => {
    const request = updateAgentPersonalityRequestSchema.parse({
      personality: '  Seek open adjacent cells.  ',
    });
    expect(request).toEqual({ personality: 'Seek open adjacent cells.' });
    expect(
      updateAgentPersonalityResponseSchema.safeParse({
        snapshot,
        agent: { ...worldAgent, personality: request.personality },
      }).success,
    ).toBe(true);
  });

  it.each([
    { personality: '' },
    { personality: '   ' },
    { personality: 'x'.repeat(PERSONALITY_MAX_LENGTH + 1) },
    { personality: 42 },
    { personality: 'Valid.', unexpected: true },
    null,
  ])('rejects empty, oversized, or malformed updates', (request) => {
    expect(updateAgentPersonalityRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });

  it('validates restore-default responses and typed safe errors', () => {
    expect(
      restoreDefaultPersonalitiesResponseSchema.safeParse({ snapshot }).success,
    ).toBe(true);
    expect(
      apiErrorSchema.safeParse({
        error: {
          code: 'personality_conflict',
          message: 'A turn is active.',
        },
      }).success,
    ).toBe(true);
    expect(
      apiErrorSchema.safeParse({
        error: { code: 'provider_secret', message: 'unsafe' },
      }).success,
    ).toBe(false);
  });
});
