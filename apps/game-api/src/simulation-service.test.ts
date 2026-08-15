import { describe, expect, it } from 'vitest';
import { gridDistance } from 'h3-js';
import {
  AgentProviderError,
  ScriptedAgentProvider,
  type AgentProvider,
  type ProviderDecision,
} from '@agentborne/agent-runtime';
import {
  PERSONALITY_MAX_LENGTH,
  agentIdSchema,
  experimentExportDocumentSchema,
  h3CellSchema,
  type AgentObservation,
  type AgentTurnRecord,
  type WorldEvent,
} from '@agentborne/shared';
import { DEVELOPMENT_AGENT_BLUEPRINTS } from '@agentborne/world-engine';
import {
  SimulationConflictError,
  SimulationService,
  SimulationValidationError,
} from './simulation-service';
import { serializeExperimentExport } from './experiment-export';

const now = () => '2026-08-13T12:00:01.000Z';
const createEventId = () => '67aa21b9-fc78-4b04-9f92-9862bf346f96';

function service(provider: AgentProvider) {
  return new SimulationService({ provider, now, createEventId });
}

function exportRequest(level: 'minimal' | 'standard' | 'full-safe' | 'custom') {
  return {
    agents: { mode: 'all' as const },
    turns: { mode: 'entire-retained' as const },
    outcomes: ['accepted', 'rejected', 'provider-error'] as const,
    actions: ['move', 'infect', 'capture', 'wait'] as const,
    communications: { channel: 'all' as const, status: 'all' as const },
    level,
  };
}

describe('SimulationService', () => {
  it('derives authoritative territory, bounded control history, capture metrics, and victim-aware exports', async () => {
    const emberId = agentIdSchema.parse(DEVELOPMENT_AGENT_BLUEPRINTS[0].id);
    const rookId = agentIdSchema.parse(DEVELOPMENT_AGENT_BLUEPRINTS[1].id);
    let targetCell: AgentObservation['currentCell']['cell'] | undefined;
    let emberDeparted = false;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'capture-scenario',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        let worldAction: ProviderDecision['decision']['worldAction'];
        if (observation.agentId === emberId && !targetCell) {
          targetCell = observation.currentCell.cell;
          worldAction = { type: 'infect' };
        } else if (observation.agentId === emberId && !emberDeparted) {
          emberDeparted = true;
          worldAction = {
            type: 'move',
            targetCell: observation.adjacentCells[0]!.cell,
          };
        } else if (observation.agentId === rookId) {
          if (
            observation.currentCell.cell === targetCell &&
            observation.captureEligibility.eligible
          ) {
            worldAction = { type: 'capture' };
          } else if (observation.currentCell.cell === targetCell) {
            worldAction = { type: 'wait' };
          } else {
            const target = targetCell!;
            const next = observation.adjacentCells.toSorted(
              (left, right) =>
                gridDistance(left.cell, target) -
                  gridDistance(right.cell, target) ||
                left.cell.localeCompare(right.cell),
            )[0]!;
            worldAction = { type: 'move', targetCell: next.cell };
          }
        } else {
          worldAction = { type: 'wait' };
        }
        return {
          decision: { worldAction, summary: 'Deterministic contest.' },
          metadata: {
            provider: 'scripted-test',
            model: 'capture-scenario',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    let capture: AgentTurnRecord | undefined;
    for (let index = 0; index < 31 && !capture; index += 1) {
      const turn = await simulation.executeNextTurn();
      if (
        turn.outcome === 'accepted' &&
        turn.worldActionResult.event.type === 'hex-captured'
      )
        capture = turn;
    }
    expect(capture).toMatchObject({
      agentId: rookId,
      worldAction: { type: 'capture' },
      worldActionResult: {
        event: {
          controllerAgentId: rookId,
          previousControllerAgentId: emberId,
          cell: targetCell,
        },
      },
    });
    if (!capture || capture.outcome !== 'accepted')
      throw new Error('Expected a successful capture fixture.');
    expect(capture.observation.currentCell).toMatchObject({
      state: 'infected',
      controllerAgentId: emberId,
    });
    expect(capture.observation.captureEligibility).toEqual({ eligible: true });
    expect(capture.observation.adjacentCells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ controllerAgentId: null }),
      ]),
    );
    expect(capture.observation.territoryScoreboard).toHaveLength(6);
    expect(
      capture.observation.territoryScoreboard.reduce(
        (sum, { controlledCellCount }) => sum + controlledCellCount,
        0,
      ),
    ).toBe(1);
    const snapshot = simulation.getSnapshot();
    expect(
      snapshot.world.hexes.filter(({ state }) => state === 'infected'),
    ).toHaveLength(1);
    expect(
      snapshot.world.hexes.find(({ cell }) => cell === targetCell),
    ).toMatchObject({ state: 'infected', controllerAgentId: rookId });
    expect(
      snapshot.experiment.currentTerritory.reduce(
        (sum, { controlledCellCount }) => sum + controlledCellCount,
        0,
      ),
    ).toBe(1);
    expect(
      snapshot.experiment.currentTerritory.find(
        ({ agentId }) => agentId === rookId,
      )?.controlledCellCount,
    ).toBe(1);
    expect(
      snapshot.experiment.metrics.byAgent.find(
        ({ agentId }) => agentId === emberId,
      )?.metrics,
    ).toMatchObject({
      territoryGainedThroughInfection: 1,
      territoryLostThroughCapture: 1,
    });
    expect(
      snapshot.experiment.metrics.byAgent.find(
        ({ agentId }) => agentId === rookId,
      )?.metrics,
    ).toMatchObject({
      requestedCaptures: 1,
      successfulCaptures: 1,
      territoryGainedThroughCapture: 1,
    });

    const subsequent: AgentTurnRecord[] = [];
    for (let index = 0; index < 6; index += 1)
      subsequent.push(await simulation.executeNextTurn());
    const emberObservation = subsequent.find(
      ({ agentId }) => agentId === emberId,
    )?.observation;
    const rookObservation = subsequent.find(
      ({ agentId }) => agentId === rookId,
    )?.observation;
    expect(emberObservation?.recentControlChanges).toMatchObject([
      { direction: 'lost', otherAgentId: rookId, cell: targetCell },
    ]);
    expect(rookObservation?.recentControlChanges).toMatchObject([
      { direction: 'gained', otherAgentId: emberId, cell: targetCell },
    ]);
    expect(
      subsequent
        .filter(({ agentId }) => agentId !== emberId && agentId !== rookId)
        .every(
          ({ observation }) => observation.recentControlChanges.length === 0,
        ),
    ).toBe(true);

    const victimExport = simulation.generateExperimentExport({
      agents: { mode: 'selected', agentIds: [emberId] },
      turns: { mode: 'entire-retained' },
      outcomes: ['accepted'],
      actions: ['capture'],
      level: 'minimal',
    });
    expect(victimExport.schemaVersion).toBe(4);
    expect(victimExport.turns).toHaveLength(0);
    expect(victimExport.selection).toMatchObject({
      matchingTurnCount: 0,
      matchingControlChangeCount: 1,
    });
    expect(victimExport.controlChanges).toMatchObject([
      {
        controllerAgentId: rookId,
        previousControllerAgentId: emberId,
      },
    ]);
    expect(victimExport.metrics?.byAgent[0]?.metrics).toMatchObject({
      totalTurns: 0,
      territoryLostThroughCapture: 1,
    });
    expect(victimExport.currentTerritory).toHaveLength(6);
    const unrelatedAgentId = agentIdSchema.parse(
      DEVELOPMENT_AGENT_BLUEPRINTS[2].id,
    );
    expect(
      simulation.generateExperimentExport({
        ...exportRequest('minimal'),
        agents: { mode: 'selected', agentIds: [unrelatedAgentId] },
        outcomes: ['accepted'],
        actions: ['capture'],
      }).controlChanges,
    ).toEqual([]);
  });

  it('records controller-present rejection without control mutation or gain/loss metrics', async () => {
    const emberId = agentIdSchema.parse(DEVELOPMENT_AGENT_BLUEPRINTS[0].id);
    const rookId = agentIdSchema.parse(DEVELOPMENT_AGENT_BLUEPRINTS[1].id);
    let targetCell: AgentObservation['currentCell']['cell'] | undefined;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'defended-capture-scenario',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        let worldAction: ProviderDecision['decision']['worldAction'];
        if (observation.agentId === emberId && !targetCell) {
          targetCell = observation.currentCell.cell;
          worldAction = { type: 'infect' };
        } else if (observation.agentId === rookId) {
          if (observation.currentCell.cell === targetCell) {
            worldAction = { type: 'capture' };
          } else {
            const next = observation.adjacentCells.toSorted(
              (left, right) =>
                gridDistance(left.cell, targetCell!) -
                  gridDistance(right.cell, targetCell!) ||
                left.cell.localeCompare(right.cell),
            )[0]!;
            worldAction = { type: 'move', targetCell: next.cell };
          }
        } else {
          worldAction = { type: 'wait' };
        }
        return {
          decision: { worldAction, summary: 'Test defended capture.' },
          metadata: {
            provider: 'scripted-test',
            model: 'defended-capture-scenario',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    let rejected: AgentTurnRecord | undefined;
    for (let index = 0; index < 31 && !rejected; index += 1) {
      const turn = await simulation.executeNextTurn();
      if (
        turn.outcome === 'rejected' &&
        turn.worldActionResult.reason === 'controller-present'
      )
        rejected = turn;
    }
    expect(rejected).toMatchObject({
      agentId: rookId,
      worldAction: { type: 'capture' },
      observation: {
        captureEligibility: {
          eligible: false,
          blockedReason: 'controller-present',
        },
      },
    });
    const snapshot = simulation.getSnapshot();
    expect(
      snapshot.world.hexes.find(({ cell }) => cell === targetCell),
    ).toEqual(expect.objectContaining({ controllerAgentId: emberId }));
    expect(snapshot.world.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'hex-captured' }),
      ]),
    );
    expect(snapshot.experiment.metrics.aggregate).toMatchObject({
      requestedCaptures: 1,
      successfulCaptures: 0,
      territoryGainedThroughCapture: 0,
      territoryLostThroughCapture: 0,
    });
    const exported = simulation.generateExperimentExport({
      ...exportRequest('standard'),
      agents: { mode: 'selected', agentIds: [rookId] },
      outcomes: ['rejected'],
      actions: ['capture'],
    });
    expect(exported.schemaVersion).toBe(4);
    expect(exported.turns).toMatchObject([
      {
        outcome: 'rejected',
        worldActionResult: {
          accepted: false,
          reason: 'controller-present',
        },
        observation: {
          captureEligibility: {
            eligible: false,
            blockedReason: 'controller-present',
          },
        },
      },
    ]);
    expect(exported.controlChanges).toEqual([]);
  });

  it('resets to the exact deterministic six-agent starting world', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    const initial = simulation.getSnapshot();
    await simulation.executeNextTurn();
    const reset = simulation.reset();
    expect(reset.world).toEqual(initial.world);
    expect(reset.experiment.id).not.toBe(initial.experiment.id);
    expect(reset.experiment.totalCompletedTurns).toBe(0);
    expect(initial.world.agents).toHaveLength(6);
    expect(initial.world.hexes).toHaveLength(61);
  });

  it('retains complete experiment records independently of the 120-turn browser snapshot', async () => {
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'retention-test',
      configured: true,
      async decide() {
        return {
          decision: {
            worldAction: { type: 'wait' as const },
            summary: 'Wait.',
          },
          metadata: {
            provider: 'scripted-test' as const,
            model: 'retention-test',
            latencyMs: 1,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = new SimulationService({
      provider,
      now,
      createEventId,
      experimentRetentionLimit: 125,
    });
    for (let index = 0; index < 125; index += 1)
      await simulation.executeNextTurn();
    const snapshot = simulation.getSnapshot();
    expect(snapshot.turns).toHaveLength(120);
    expect(snapshot.experiment).toMatchObject({
      totalCompletedTurns: 125,
      retainedTurns: 125,
      droppedRecords: 0,
      complete: true,
    });
    expect(
      simulation.generateExperimentExport(exportRequest('full-safe')).turns,
    ).toHaveLength(125);
  });

  it('reports configurable experiment truncation and absolute retained bounds', async () => {
    const simulation = new SimulationService({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: '1' },
        { worldAction: { type: 'wait' }, summary: '2' },
        { worldAction: { type: 'wait' }, summary: '3' },
      ]),
      now,
      createEventId,
      experimentRetentionLimit: 2,
    });
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    expect(simulation.getSnapshot().experiment).toMatchObject({
      retainedTurns: 2,
      firstRetainedTurn: 2,
      lastRetainedTurn: 3,
      droppedRecords: 1,
      complete: false,
    });
    const preview = simulation.previewExperimentExport({
      ...exportRequest('minimal'),
      turns: { mode: 'range', fromTurn: 1, toTurn: 3 },
    });
    expect(preview.retention.requestedRangeExtendsBeyondRetention).toBe(true);
  });

  it('estimates the selected Compact or Pretty serialization and defaults to Compact', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    );
    await simulation.executeNextTurn();
    const compact = simulation.previewExperimentExport(
      exportRequest('minimal'),
    );
    const pretty = simulation.previewExperimentExport({
      ...exportRequest('minimal'),
      serialization: 'pretty',
    });
    expect(compact.serializedUtf8Bytes).toBeLessThan(
      pretty.serializedUtf8Bytes,
    );
    expect(compact.approximateAiInputTokens).toBeLessThan(
      pretty.approximateAiInputTokens,
    );
    expect(
      simulation.generateExperimentExport(exportRequest('minimal')).filters
        .serialization,
    ).toBe('compact');
  });

  it('aggregates charged cost as exact decimal input without JSON artifacts', async () => {
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'decimal-cost-test',
      configured: true,
      async decide() {
        return {
          decision: {
            worldAction: { type: 'wait' as const },
            summary: 'Wait.',
          },
          metadata: {
            provider: 'scripted-test' as const,
            model: 'decimal-cost-test',
            latencyMs: 0,
            costCredits: 0.14064472125,
          },
        };
      },
    };
    const simulation = service(provider);
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    const document = simulation.generateExperimentExport(
      exportRequest('minimal'),
    );
    expect(document.metrics?.aggregate.knownCostCredits).toBe(0.42193416375);
    expect(serializeExperimentExport(document)).toContain(
      '"knownCostCredits":0.42193416375',
    );
    expect(serializeExperimentExport(document)).not.toContain(
      '0.4219341637499998',
    );
  });

  it('records immutable personality configuration history and clears it on reset', () => {
    let sequence = 0;
    const simulation = new SimulationService({
      provider: new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
      now,
      createEventId,
      createExperimentId: () =>
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, '0')}`,
    });
    const before = simulation.getSnapshot();
    const agent = before.world.agents[0]!;
    simulation.updateAgentPersonality(agent.id, 'Custom immutable edit.');
    simulation.restoreDefaultPersonalities();
    const full = simulation.generateExperimentExport(
      exportRequest('full-safe'),
    );
    expect(full.configurationEvents).toMatchObject([
      {
        operation: 'custom-edit',
        previousPersonality: agent.personality,
        newPersonality: 'Custom immutable edit.',
      },
      {
        operation: 'restore-default',
        previousPersonality: 'Custom immutable edit.',
        newPersonality: agent.personality,
      },
    ]);
    const captured = structuredClone(full.configurationEvents);
    simulation.updateAgentPersonality(agent.id, 'Another edit.');
    expect(full.configurationEvents).toEqual(captured);
    const reset = simulation.reset();
    expect(reset.experiment.id).not.toBe(before.experiment.id);
    expect(
      simulation.generateExperimentExport(exportRequest('full-safe'))
        .configurationEvents,
    ).toEqual([]);
  });

  it('filters agents, latest/ranges, outcomes and actions chronologically with subset metrics', async () => {
    let call = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'filter-test',
      configured: true,
      async decide(observation) {
        call += 1;
        const worldAction =
          call === 1
            ? { type: 'infect' as const }
            : call === 2
              ? {
                  type: 'move' as const,
                  targetCell: observation.adjacentCells[0]!.cell,
                }
              : { type: 'wait' as const };
        return {
          decision: { worldAction, summary: 'Safe summary.' },
          metadata: {
            provider: 'scripted-test',
            model: 'filter-test',
            latencyMs: call,
            promptTokens: call,
            completionTokens: call,
            totalTokens: call * 2,
            costCredits: call === 3 ? undefined : 0.00000001,
          },
        };
      },
    };
    const simulation = service(provider);
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    const agents = simulation.getSnapshot().world.agents;
    const selected = [agents[0]!.id, agents[1]!.id];
    const document = simulation.generateExperimentExport({
      ...exportRequest('standard'),
      agents: { mode: 'selected', agentIds: selected },
      turns: { mode: 'latest', count: 10 },
      outcomes: ['accepted'],
      actions: ['move', 'infect'],
    });
    expect(document.selection.selectedAgentIds).toEqual(selected);
    expect(document.turns.map(({ turnNumber }) => turnNumber)).toEqual([1, 2]);
    expect(document.metrics?.aggregate).toMatchObject({
      totalTurns: 2,
      requestedMoves: 1,
      requestedInfections: 1,
      acceptedMovements: 1,
      successfullyInfectedCells: 1,
      knownCostCredits: 0.00000002,
      turnsWithUnknownCost: 0,
    });
    expect(document.metrics?.aggregate.uniqueVisitedCells).toBeGreaterThan(1);
    const oneAgent = simulation.generateExperimentExport({
      ...exportRequest('minimal'),
      agents: { mode: 'selected', agentIds: [agents[2]!.id] },
      turns: { mode: 'range', fromTurn: 3, toTurn: 3 },
    });
    expect(oneAgent.selection).toMatchObject({
      selectedAgentIds: [agents[2]!.id],
      matchingTurnCount: 1,
      firstMatchingTurn: 3,
      lastMatchingTurn: 3,
    });
    expect(
      simulation.generateExperimentExport(exportRequest('minimal')).metrics
        ?.aggregate,
    ).toMatchObject({
      knownCostCredits: 0.00000002,
      turnsWithUnknownCost: 1,
    });
  });

  it('keeps Full safe world snapshots state-only and scopes canonical events to the export selection', async () => {
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'full-safe-event-scope-test',
      configured: true,
      async decide() {
        return {
          decision: {
            worldAction: { type: 'wait' as const },
            summary: 'Wait.',
          },
          metadata: {
            provider: 'scripted-test' as const,
            model: 'full-safe-event-scope-test',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    for (let index = 0; index < 7; index += 1)
      await simulation.executeNextTurn();

    const agents = simulation.getSnapshot().world.agents;
    const selectedAgent = agents[0]!;
    const oneAgent = simulation.generateExperimentExport({
      ...exportRequest('full-safe'),
      agents: { mode: 'selected', agentIds: [selectedAgent.id] },
      turns: { mode: 'range', fromTurn: 1, toTurn: 6 },
      outcomes: ['accepted'],
      actions: ['wait'],
    });

    expect(oneAgent.initialWorld?.agents).toHaveLength(6);
    expect(oneAgent.initialWorld?.hexes).toHaveLength(61);
    expect(oneAgent.currentWorld?.agents).toHaveLength(6);
    expect(oneAgent.currentWorld?.hexes).toHaveLength(61);
    expect(oneAgent.initialWorld).not.toHaveProperty('events');
    expect(oneAgent.currentWorld).not.toHaveProperty('events');
    expect(oneAgent.worldEvents).toHaveLength(1);
    expect(
      oneAgent.worldEvents?.every(
        ({ agentId }) => agentId === selectedAgent.id,
      ),
    ).toBe(true);
    expect(oneAgent.turns.map(({ turnNumber }) => turnNumber)).toEqual([1]);

    const allAgents = simulation.generateExperimentExport(
      exportRequest('full-safe'),
    );
    expect(allAgents.selection.selectedAgentIds).toEqual(
      agents.map(({ id }) => id),
    );
    expect(allAgents.turns).toHaveLength(7);
    expect(allAgents.worldEvents).toHaveLength(7);
    expect(allAgents.initialWorld).not.toHaveProperty('events');
    expect(allAgents.currentWorld).not.toHaveProperty('events');
  });

  it('exports accepted communications for either participant without importing unrelated or rejected messages', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    ).getSnapshot();
    const [sender, recipient] = initial.world.agents;
    let call = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'message-export-test',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        call += 1;
        const communication =
          call === 1
            ? {
                channel: 'direct' as const,
                recipientId: recipient!.id,
                message: 'Inbound selection proof.',
              }
            : call === 2
              ? {
                  channel: 'public' as const,
                  message: 'Selected-author public message.',
                }
              : call === 3
                ? {
                    channel: 'direct' as const,
                    recipientId: observation.nearbyAgents.find(
                      ({ id, distance }) =>
                        distance <= 3 &&
                        id !== sender!.id &&
                        id !== recipient!.id,
                    )!.id,
                    message: 'Unrelated communication.',
                  }
                : call === 4
                  ? {
                      channel: 'direct' as const,
                      recipientId: observation.agentId,
                      message: 'Rejected self message.',
                    }
                  : call === 5
                    ? {
                        channel: 'public' as const,
                        message: 'Unselected-author public message.',
                      }
                    : undefined;
        return {
          decision: {
            worldAction: { type: 'wait' },
            ...(communication ? { communication } : {}),
            summary: 'Test export.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'message-export-test',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    for (let index = 0; index < 5; index += 1)
      await simulation.executeNextTurn();

    const inboundRequest = {
      ...exportRequest('minimal'),
      agents: { mode: 'selected', agentIds: [recipient!.id] },
      outcomes: ['accepted'],
      actions: ['wait'],
      communications: { channel: 'direct', status: 'accepted' },
    } as const;
    const inbound = simulation.generateExperimentExport(inboundRequest);
    expect(inbound.turns.map(({ turnNumber }) => turnNumber)).toEqual([2]);
    expect(inbound.communications).toMatchObject([
      {
        originatingTurn: 1,
        agentId: sender!.id,
        recipientId: recipient!.id,
        message: 'Inbound selection proof.',
      },
    ]);
    expect(inbound.metrics?.aggregate).toMatchObject({
      directMessagesRequested: 0,
      directMessagesDelivered: 0,
      directMessagesSent: 0,
      directMessagesReceived: 1,
    });
    const inboundPreview = simulation.previewExperimentExport(inboundRequest);
    const inboundBytes = new TextEncoder().encode(
      serializeExperimentExport(inbound),
    ).byteLength;
    expect(inboundPreview).toMatchObject({
      matchingTurnCount: 1,
      matchingCommunicationCount: 1,
      serializedUtf8Bytes: inboundBytes,
      approximateAiInputTokens: Math.ceil(inboundBytes / 4),
    });
    const multiAgent = simulation.generateExperimentExport({
      ...inboundRequest,
      agents: {
        mode: 'selected',
        agentIds: [sender!.id, recipient!.id],
      },
      communications: { channel: 'all', status: 'all' },
    });
    expect(multiAgent.communications).toMatchObject([
      { channel: 'direct', message: 'Inbound selection proof.' },
      { channel: 'public', message: 'Selected-author public message.' },
    ]);
    const allAgent = simulation.generateExperimentExport({
      ...exportRequest('minimal'),
      communications: { channel: 'all', status: 'all' },
    });
    expect(allAgent.communications).toHaveLength(5);
    expect(
      simulation.generateExperimentExport({
        ...inboundRequest,
        communications: { channel: 'public', status: 'all' },
      }).communications,
    ).toMatchObject([
      {
        originatingTurn: 2,
        agentId: recipient!.id,
        channel: 'public',
        message: 'Selected-author public message.',
      },
    ]);
    for (const filteredRequest of [
      {
        ...inboundRequest,
        communications: { channel: 'all', status: 'rejected' },
      },
      {
        ...inboundRequest,
        turns: { mode: 'range', fromTurn: 2, toTurn: 4 },
      },
    ])
      expect(
        simulation.generateExperimentExport(filteredRequest).communications,
      ).toEqual([]);
    const senderFull = simulation.generateExperimentExport({
      ...inboundRequest,
      level: 'full-safe',
      agents: { mode: 'selected', agentIds: [sender!.id] },
      actions: ['wait'],
    });
    expect(senderFull.turns).toHaveLength(1);
    expect(senderFull.turns[0]?.communicationResult).toMatchObject({
      accepted: true,
      event: { type: 'direct-message-sent' },
    });
    expect(senderFull.communications).toHaveLength(1);
    expect(senderFull.worldEvents).toMatchObject([{ type: 'agent-waited' }]);
    expect(senderFull.initialWorld).not.toHaveProperty('events');
    expect(senderFull.currentWorld).not.toHaveProperty('events');

    const rejectedSender = initial.world.agents[3]!;
    const rejected = simulation.generateExperimentExport({
      ...exportRequest('full-safe'),
      agents: { mode: 'selected', agentIds: [rejectedSender.id] },
      outcomes: ['accepted'],
      actions: ['wait'],
      communications: { channel: 'direct', status: 'rejected' },
    });
    expect(rejected.turns).toHaveLength(1);
    expect(rejected.turns[0]).toMatchObject({
      outcome: 'accepted',
      communicationResult: { accepted: false, reason: 'self-message' },
    });
    expect(rejected.communications).toMatchObject([
      { status: 'rejected', rejectionReason: 'self-message' },
    ]);
    expect(rejected.worldEvents).toMatchObject([{ type: 'agent-waited' }]);
    expect(rejected.metrics?.aggregate).toMatchObject({
      directMessagesRequested: 1,
      directMessagesDelivered: 0,
      directMessagesRejected: 1,
    });
  });

  it('produces predictable Minimal, Standard, Full safe and Custom omissions without mutation', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    );
    await simulation.executeNextTurn();
    const before = simulation.getSnapshot();
    expect(() =>
      simulation.generateExperimentExport({
        ...exportRequest('minimal'),
        outcomes: [],
      }),
    ).toThrow(/invalid/i);
    expect(simulation.getSnapshot()).toEqual(before);
    const minimal = simulation.generateExperimentExport(
      exportRequest('minimal'),
    );
    const standard = simulation.generateExperimentExport(
      exportRequest('standard'),
    );
    const full = simulation.generateExperimentExport(
      exportRequest('full-safe'),
    );
    const custom = simulation.generateExperimentExport({
      ...exportRequest('custom'),
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
        communications: false,
        controlChanges: false,
      },
    });
    expect(minimal.schemaVersion).toBe(4);
    expect(
      experimentExportDocumentSchema.safeParse({
        ...minimal,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(minimal.turns[0]).not.toHaveProperty('observation');
    expect(standard.turns[0]).toHaveProperty('observation');
    expect(full).toHaveProperty('initialWorld');
    expect(full).toHaveProperty('configurationEvents');
    expect(full.initialWorld).not.toHaveProperty('events');
    expect(full.currentWorld).not.toHaveProperty('events');
    expect(full.worldEvents).toEqual([
      expect.objectContaining({ agentId: before.world.agents[0]!.id }),
    ]);
    expect(minimal.communications).toEqual([]);
    expect(standard.communications).toEqual([]);
    expect(full.communications).toEqual([]);
    expect(custom).not.toHaveProperty('communications');
    expect(custom).not.toHaveProperty('controlChanges');
    expect(custom).not.toHaveProperty('metrics');
    expect(custom.turns[0]).not.toHaveProperty('provider');
    minimal.turns[0]!.outcome = 'rejected';
    expect(
      simulation.generateExperimentExport(exportRequest('minimal')).turns[0]
        ?.outcome,
    ).toBe('accepted');
    expect(simulation.getSnapshot()).toEqual(before);
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
          decision: { worldAction: { type: 'wait' }, summary: 'Wait.' },
          metadata: {
            provider: 'scripted-test',
            model: 'recording-test',
            latencyMs: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    const order = simulation.getSnapshot().world.agents.map(({ id }) => id);
    for (let index = 0; index < 7; index += 1)
      await simulation.executeNextTurn();
    expect(seen).toHaveLength(7);
    expect(seen.map(({ agentId }) => agentId)).toEqual([...order, order[0]]);
  });

  it('keeps total turn numbering and round robin independent of retained history', async () => {
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'long-running-test',
      configured: true,
      async decide(): Promise<ProviderDecision> {
        return {
          decision: { worldAction: { type: 'wait' }, summary: 'Wait.' },
          metadata: {
            provider: 'scripted-test',
            model: 'long-running-test',
            latencyMs: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    const agentOrder = simulation
      .getSnapshot()
      .world.agents.map(({ id }) => id);

    for (let index = 0; index < 125; index += 1) {
      await simulation.executeNextTurn();
    }

    const snapshot = simulation.getSnapshot();
    const retainedNumbers = snapshot.turns.map(({ turnNumber }) => turnNumber);
    expect(snapshot.turnNumber).toBe(125);
    expect(snapshot.turns).toHaveLength(120);
    expect(retainedNumbers).toEqual(
      Array.from({ length: 120 }, (_, index) => index + 6),
    );
    expect(new Set(retainedNumbers).size).toBe(120);
    expect(snapshot.turns.map(({ agentId }) => agentId)).toEqual(
      snapshot.turns.map(
        ({ turnNumber }) => agentOrder[(turnNumber - 1) % agentOrder.length],
      ),
    );
    expect(snapshot.nextAgentId).toBe(agentOrder[125 % agentOrder.length]);
  });

  it('builds each observation from the latest authoritative world state', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
        { worldAction: { type: 'wait' }, summary: 'Observe.' },
      ]),
    );
    await simulation.executeNextTurn();
    const second = await simulation.executeNextTurn();
    expect(second.observation.recentEvents).toHaveLength(1);
    expect(second.observation.recentEvents[0]?.type).toBe('hex-infected');
  });

  it('applies an infection and public message from the same provider decision', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        {
          worldAction: { type: 'infect' },
          communication: {
            channel: 'public',
            message: '  The center is claimed.  ',
          },
          summary: 'Claim and announce.',
        },
        { worldAction: { type: 'wait' }, summary: 'Observe.' },
      ]),
    );
    const first = await simulation.executeNextTurn();
    expect(first).toMatchObject({
      outcome: 'accepted',
      worldActionResult: { event: { type: 'hex-infected' } },
      communicationResult: {
        accepted: true,
        event: {
          type: 'public-message-sent',
          message: 'The center is claimed.',
        },
      },
    });
    expect(
      simulation.getSnapshot().world.events.map(({ type }) => type),
    ).toEqual(['hex-infected', 'public-message-sent']);
    const second = await simulation.executeNextTurn();
    expect(second.observation.recentPublicMessages).toMatchObject([
      { senderId: first.agentId, message: 'The center is claimed.' },
    ]);
  });

  it('preserves accepted communication when the world action is rejected', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    ).getSnapshot();
    const [sender, recipient] = initial.world.agents;
    for (const communication of [
      { channel: 'public' as const, message: 'Still speaking.' },
      {
        channel: 'direct' as const,
        recipientId: recipient!.id,
        message: 'Nearby despite the bad move.',
      },
    ]) {
      const simulation = service(
        new ScriptedAgentProvider([
          {
            worldAction: {
              type: 'move',
              targetCell: h3CellSchema.parse('8928308280fffff'),
            },
            communication,
            summary: 'Try both.',
          },
        ]),
      );
      const turn = await simulation.executeNextTurn();
      expect(turn).toMatchObject({
        agentId: sender!.id,
        outcome: 'rejected',
        worldActionResult: { accepted: false },
        communicationResult: { accepted: true },
      });
      expect(simulation.getSnapshot().world.events).toHaveLength(1);
    }
  });

  it('rejects an oversized communication without cancelling a valid world action', async () => {
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'invalid-communication-test',
      configured: true,
      async decide(): Promise<ProviderDecision> {
        return {
          decision: {
            worldAction: { type: 'infect' },
            communication: {
              channel: 'public',
              message: 'x'.repeat(281),
            },
            summary: 'Apply the valid component.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'invalid-communication-test',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    const turn = await simulation.executeNextTurn();
    expect(turn).toMatchObject({
      outcome: 'accepted',
      worldActionResult: { event: { type: 'hex-infected' } },
      communicationResult: {
        accepted: false,
        reason: 'invalid-communication',
        attempt: { channel: 'public' },
      },
    });
    if (
      turn.outcome === 'provider-error' ||
      !turn.communicationResult.requested ||
      turn.communicationResult.accepted
    )
      throw new Error('Expected rejected communication fixture.');
    expect(turn.communicationResult.attempt.message).toHaveLength(280);
    expect(simulation.getSnapshot().experiment.metrics.aggregate).toMatchObject(
      {
        publicMessagesRequested: 1,
        publicMessagesRejected: 1,
        successfullyInfectedCells: 1,
      },
    );
  });

  it('counts and exports malformed direct recipients as rejected direct attempts', async () => {
    const invalidDirectCommunications = [
      { channel: 'direct', recipientId: 'Verge', message: 'Malformed ID.' },
      { channel: 'direct', message: 'Missing ID.' },
    ];
    let call = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'invalid-direct-recipient-test',
      configured: true,
      async decide(): Promise<ProviderDecision> {
        return {
          decision: {
            worldAction: { type: 'wait' },
            communication: invalidDirectCommunications[call++],
            summary: 'Keep the malformed attempt safe.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'invalid-direct-recipient-test',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    const turns = [
      await simulation.executeNextTurn(),
      await simulation.executeNextTurn(),
    ];
    expect(
      turns.map((turn) =>
        turn.outcome === 'provider-error'
          ? undefined
          : turn.communicationResult,
      ),
    ).toMatchObject([
      {
        accepted: false,
        reason: 'invalid-communication',
        attempt: { channel: 'direct', recipientId: null, distance: null },
      },
      {
        accepted: false,
        reason: 'invalid-communication',
        attempt: { channel: 'direct', recipientId: null, distance: null },
      },
    ]);
    expect(simulation.getSnapshot().experiment.metrics.aggregate).toMatchObject(
      {
        publicMessagesRequested: 0,
        publicMessagesRejected: 0,
        directMessagesRequested: 2,
        directMessagesRejected: 2,
      },
    );

    const exported = simulation.generateExperimentExport({
      ...exportRequest('minimal'),
      communications: { channel: 'direct', status: 'rejected' },
    });
    expect(exported.communications).toMatchObject([
      {
        originatingTurn: 1,
        channel: 'direct',
        recipientId: null,
        message: 'Malformed ID.',
        status: 'rejected',
        rejectionReason: 'invalid-communication',
      },
      {
        originatingTurn: 2,
        channel: 'direct',
        recipientId: null,
        message: 'Missing ID.',
        status: 'rejected',
        rejectionReason: 'invalid-communication',
      },
    ]);
    expect(exported.metrics?.aggregate).toMatchObject({
      publicMessagesRequested: 0,
      publicMessagesRejected: 0,
      directMessagesRequested: 2,
      directMessagesRejected: 2,
    });
    expect(
      simulation.generateExperimentExport({
        ...exportRequest('minimal'),
        communications: { channel: 'public', status: 'rejected' },
      }).communications,
    ).toEqual([]);
  });

  it('uses pre-action positions for direct-message range', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    ).getSnapshot();
    const sender = initial.world.agents[0]!;
    const recipient = initial.world.agents.find(
      (candidate) =>
        gridDistance(sender.currentCell, candidate.currentCell) === 4,
    )!;
    const targetCell = initial.world.hexes.find(
      ({ cell }) =>
        gridDistance(sender.currentCell, cell) === 1 &&
        gridDistance(cell, recipient.currentCell) === 3,
    )!.cell;
    const simulation = service(
      new ScriptedAgentProvider([
        {
          worldAction: { type: 'move', targetCell },
          communication: {
            channel: 'direct',
            recipientId: recipient.id,
            message: 'This must use the old distance.',
          },
          summary: 'Move closer and try to message.',
        },
      ]),
    );
    const turn = await simulation.executeNextTurn();
    expect(turn).toMatchObject({
      outcome: 'accepted',
      communicationResult: {
        accepted: false,
        reason: 'out-of-range',
        attempt: { distance: 4 },
      },
    });
    expect(simulation.getSnapshot().world.agents[0]?.currentCell).toBe(
      targetCell,
    );
  });

  it('delivers direct messages alongside world actions and exposes inbound and outbound context', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    ).getSnapshot();
    const sender = initial.world.agents[0]!;
    const recipient = initial.world.agents[1]!;
    const simulation = service(
      new ScriptedAgentProvider([
        {
          worldAction: { type: 'wait' },
          communication: {
            channel: 'direct',
            recipientId: recipient.id,
            message: '  Hold near the center.  ',
          },
          summary: 'Coordinate.',
        },
        { worldAction: { type: 'wait' }, summary: 'Observe.' },
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
        { worldAction: { type: 'wait' }, summary: 'Observe sender.' },
      ]),
    );
    const before = simulation.getSnapshot().world;
    const sent = await simulation.executeNextTurn();
    expect(sent).toMatchObject({
      agentId: sender.id,
      outcome: 'accepted',
      communicationResult: {
        event: {
          type: 'direct-message-sent',
          recipientId: recipient.id,
          message: 'Hold near the center.',
        },
      },
    });
    expect(simulation.getSnapshot().world.agents).toEqual(before.agents);
    expect(simulation.getSnapshot().world.hexes).toEqual(before.hexes);

    const recipientTurn = await simulation.executeNextTurn();
    expect(recipientTurn.observation.recentDirectMessages).toMatchObject([
      {
        senderId: sender.id,
        recipientId: recipient.id,
        direction: 'inbound',
        message: 'Hold near the center.',
      },
    ]);
    const unrelatedTurn = await simulation.executeNextTurn();
    expect(unrelatedTurn.observation.recentDirectMessages).toEqual([]);
    for (let index = 0; index < 4; index += 1)
      await simulation.executeNextTurn();
    const senderTurn = simulation.getSnapshot().turns.at(-1)!;
    expect(senderTurn.agentId).toBe(sender.id);
    expect(senderTurn.observation.recentDirectMessages[0]).toMatchObject({
      direction: 'outbound',
      recipientId: recipient.id,
    });
  });

  it('rejects self and unknown recipients without a delivered event', async () => {
    const ids = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    )
      .getSnapshot()
      .world.agents.map(({ id }) => id);
    for (const [recipientId, reason] of [
      [ids[0]!, 'self-message'],
      [
        agentIdSchema.parse('6b58a30d-5d47-4ea3-8c1c-43edcc919553'),
        'unknown-recipient',
      ],
    ] as const) {
      const simulation = service(
        new ScriptedAgentProvider([
          {
            worldAction: { type: 'wait' },
            communication: {
              channel: 'direct',
              recipientId,
              message: 'Hello.',
            },
            summary: 'Try message.',
          },
        ]),
      );
      expect(await simulation.executeNextTurn()).toMatchObject({
        outcome: 'accepted',
        communicationResult: { accepted: false, reason },
      });
      expect(simulation.getSnapshot().world.events).toHaveLength(1);
    }
  });

  it('keeps recent communication context chronological and capped at six', async () => {
    const seen: AgentObservation[] = [];
    let clock = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'communication-history-test',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        seen.push(observation);
        const target = observation.nearbyAgents.find(
          ({ distance }) => distance <= 3,
        );
        return {
          decision: {
            worldAction: { type: 'wait' },
            communication: target
              ? {
                  channel: 'direct',
                  recipientId: target.id,
                  message: `Turn ${seen.length}`,
                }
              : undefined,
            summary: 'Message.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'communication-history-test',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = new SimulationService({
      provider,
      now: () =>
        new Date(
          Date.parse('2026-08-13T12:00:00.000Z') + clock++,
        ).toISOString(),
      createEventId,
    });
    for (let index = 0; index < 48; index += 1)
      await simulation.executeNextTurn();
    const bounded = seen.findLast(
      ({ recentDirectMessages }) => recentDirectMessages.length === 6,
    );
    expect(bounded?.recentDirectMessages).toHaveLength(6);
    expect(
      bounded?.recentDirectMessages.map(({ occurredAt }) => occurredAt),
    ).toEqual(
      bounded?.recentDirectMessages
        .map(({ occurredAt }) => occurredAt)
        .toSorted(),
    );
  });

  it('keeps public world chat chronological, globally visible, and capped at twelve', async () => {
    const seen: AgentObservation[] = [];
    let clock = 0;
    let eventSequence = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'public-history-test',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        seen.push(observation);
        return {
          decision: {
            worldAction: { type: 'wait' },
            communication: {
              channel: 'public',
              message: `Public ${seen.length}`,
            },
            summary: 'Publish.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'public-history-test',
            latencyMs: 0,
            costCredits: 0,
          },
        };
      },
    };
    const simulation = new SimulationService({
      provider,
      now: () =>
        new Date(
          Date.parse('2026-08-13T12:00:00.000Z') + clock++,
        ).toISOString(),
      createEventId: () =>
        `67aa21b9-fc78-4b04-9f92-${String(++eventSequence).padStart(12, '0')}`,
    });
    for (let index = 0; index < 14; index += 1)
      await simulation.executeNextTurn();
    const bounded = seen.at(-1)!.recentPublicMessages;
    expect(bounded).toHaveLength(12);
    expect(bounded.map(({ message }) => message)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Public ${index + 2}`),
    );
    expect(new Set(bounded.map(({ senderId }) => senderId))).not.toEqual(
      new Set([seen.at(-1)!.agentId]),
    );
  });

  it('reset clears accepted communication history and metrics', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'placeholder' },
      ]),
    ).getSnapshot();
    const simulation = service(
      new ScriptedAgentProvider([
        {
          worldAction: { type: 'wait' },
          communication: {
            channel: 'public',
            message: 'Public before reset.',
          },
          summary: 'Publish.',
        },
        {
          worldAction: { type: 'wait' },
          communication: {
            channel: 'direct',
            recipientId: initial.world.agents[0]!.id,
            message: 'Direct before reset.',
          },
          summary: 'Send directly.',
        },
      ]),
    );
    await simulation.executeNextTurn();
    await simulation.executeNextTurn();
    expect(simulation.getSnapshot().world.events).toHaveLength(4);
    expect(simulation.getSnapshot().experiment.metrics.aggregate).toMatchObject(
      {
        publicMessagesRequested: 1,
        publicMessagesAccepted: 1,
        directMessagesRequested: 1,
        directMessagesDelivered: 1,
      },
    );
    const reset = simulation.reset();
    expect(reset.world.events).toEqual([]);
    expect(reset.experiment.metrics.aggregate).toMatchObject({
      publicMessagesSent: 0,
      publicMessagesRequested: 0,
      publicMessagesAccepted: 0,
      directMessagesRequested: 0,
      directMessagesDelivered: 0,
      directMessagesSent: 0,
      directMessagesReceived: 0,
    });
  });

  it('updates an existing agent and uses the trimmed personality on its next turn', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Use the edit.' },
      ]),
    );
    const agent = simulation.getSnapshot().world.agents[0]!;
    const updated = simulation.updateAgentPersonality(
      agent.id,
      '  Prioritize adjacent open cells.  ',
    );
    expect(updated).toMatchObject({
      id: agent.id,
      personality: 'Prioritize adjacent open cells.',
    });
    expect((await simulation.executeNextTurn()).observation.personality).toBe(
      'Prioritize adjacent open cells.',
    );
  });

  it('rejects unknown agents and invalid personalities without mutation, then recovers', () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'wait' }, summary: 'Wait.' },
      ]),
    );
    const before = simulation.getSnapshot();
    expect(() =>
      simulation.updateAgentPersonality(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Valid personality.',
      ),
    ).toThrow(SimulationValidationError);
    expect(() =>
      simulation.updateAgentPersonality(before.world.agents[0]!.id, '   '),
    ).toThrow(SimulationValidationError);
    expect(() =>
      simulation.updateAgentPersonality(
        before.world.agents[0]!.id,
        'x'.repeat(PERSONALITY_MAX_LENGTH + 1),
      ),
    ).toThrow(SimulationValidationError);
    expect(simulation.getSnapshot()).toEqual(before);

    simulation.updateAgentPersonality(
      before.world.agents[0]!.id,
      'Recovered personality.',
    );
    expect(simulation.getSnapshot().world.agents[0]!.personality).toBe(
      'Recovered personality.',
    );
  });

  it('edits personality without changing world progress or historical observations', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    await simulation.executeNextTurn();
    const before = simulation.getSnapshot();
    const agent = before.world.agents[0]!;
    simulation.updateAgentPersonality(agent.id, 'A new active personality.');
    const after = simulation.getSnapshot();

    expect(after.world.hexes).toEqual(before.world.hexes);
    expect(after.world.events).toEqual(before.world.events);
    expect(after.world.agents.map(({ currentCell }) => currentCell)).toEqual(
      before.world.agents.map(({ currentCell }) => currentCell),
    );
    expect(
      after.world.agents.map(({ id, name, color }) => ({ id, name, color })),
    ).toEqual(
      before.world.agents.map(({ id, name, color }) => ({ id, name, color })),
    );
    expect(after.turns).toEqual(before.turns);
    expect(after.turns[0]!.observation.personality).toBe(agent.personality);
    expect(after.turnNumber).toBe(before.turnNumber);
    expect(after.nextAgentId).toBe(before.nextAgentId);
  });

  it('reset preserves active personality edits while restoring deterministic progress', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    const initial = simulation.getSnapshot();
    for (const agent of initial.world.agents) {
      simulation.updateAgentPersonality(
        agent.id,
        `Preserve ${agent.name}'s edit.`,
      );
    }
    await simulation.executeNextTurn();
    const reset = simulation.reset();

    expect(reset).toMatchObject({ turnNumber: 0, turns: [] });
    expect(reset.world.events).toEqual([]);
    expect(reset.world.hexes).toEqual(initial.world.hexes);
    expect(reset.world.agents.map(({ currentCell }) => currentCell)).toEqual(
      initial.world.agents.map(({ currentCell }) => currentCell),
    );
    expect(reset.world.agents.map(({ personality }) => personality)).toEqual(
      initial.world.agents.map(({ name }) => `Preserve ${name}'s edit.`),
    );
  });

  it('restores all six defaults without resetting current world progress', async () => {
    const simulation = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    for (const agent of simulation.getSnapshot().world.agents) {
      simulation.updateAgentPersonality(agent.id, `Custom ${agent.name}.`);
    }
    await simulation.executeNextTurn();
    const before = simulation.getSnapshot();
    const restored = simulation.restoreDefaultPersonalities();

    expect(restored.world.agents.map(({ personality }) => personality)).toEqual(
      DEVELOPMENT_AGENT_BLUEPRINTS.map(({ personality }) => personality),
    );
    expect(
      restored.world.agents.find(({ name }) => name === 'Mingle')?.personality,
    ).toBe(
      'You are a social coalition-builder. Move toward visible agents, initiate and continue conversations, negotiate before taking their territory, and coordinate when useful. Infect open cells opportunistically, but value interaction over silent pursuit.',
    );
    expect(restored.world.hexes).toEqual(before.world.hexes);
    expect(restored.world.events).toEqual(before.world.events);
    expect(restored.turns).toEqual(before.turns);
    expect(restored.turnNumber).toBe(before.turnNumber);
    expect(restored.nextAgentId).toBe(before.nextAgentId);
    expect(restored.world.agents.map(({ currentCell }) => currentCell)).toEqual(
      before.world.agents.map(({ currentCell }) => currentCell),
    );
  });

  it('records accepted and rejected actions without mutating on rejection', async () => {
    const initial = service(
      new ScriptedAgentProvider([
        { worldAction: { type: 'infect' }, summary: 'Infect.' },
      ]),
    );
    expect((await initial.executeNextTurn()).outcome).toBe('accepted');

    const rejected = service(
      new ScriptedAgentProvider([
        {
          worldAction: {
            type: 'move',
            targetCell: h3CellSchema.parse('8928308280fffff'),
          },
          summary: 'Attempt a distant move.',
        },
        { worldAction: { type: 'wait' }, summary: 'Continue.' },
      ]),
    );
    const before = rejected.getSnapshot().world;
    expect(await rejected.executeNextTurn()).toMatchObject({
      turnNumber: 1,
      outcome: 'rejected',
    });
    expect(rejected.getSnapshot().world.hexes).toEqual(before.hexes);
    expect(rejected.getSnapshot().world.agents).toEqual(before.agents);
    expect(await rejected.executeNextTurn()).toMatchObject({
      turnNumber: 2,
      outcome: 'accepted',
    });
    expect(rejected.getSnapshot().turnNumber).toBe(2);
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
          decision: {
            worldAction: { type: 'wait' },
            summary: 'Recovered.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'failure-test',
            latencyMs: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    const before = simulation.getSnapshot().world;
    expect(await simulation.executeNextTurn()).toMatchObject({
      turnNumber: 1,
      outcome: 'provider-error',
    });
    expect(simulation.getSnapshot().world).toEqual(before);
    expect(await simulation.executeNextTurn()).toMatchObject({
      turnNumber: 2,
      outcome: 'accepted',
    });
    expect(simulation.getSnapshot().turnNumber).toBe(2);
  });

  it('does not commit or advance after post-provider validation fails', async () => {
    const seenAgentIds: AgentObservation['agentId'][] = [];
    let calls = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'invalid-metadata-test',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        calls += 1;
        seenAgentIds.push(observation.agentId);
        if (calls === 1) {
          return {
            decision: {
              worldAction: { type: 'wait' },
              summary: 'Invalid metadata follows.',
            },
            metadata: {
              provider: 'scripted-test',
              model: '',
              latencyMs: 0,
            },
          } as ProviderDecision;
        }
        return {
          decision: { worldAction: { type: 'wait' }, summary: 'Valid.' },
          metadata: {
            provider: 'scripted-test',
            model: 'invalid-metadata-test',
            latencyMs: 0,
          },
        };
      },
    };
    const simulation = service(provider);
    const before = simulation.getSnapshot();

    await expect(simulation.executeNextTurn()).rejects.toBeDefined();

    const afterFailure = simulation.getSnapshot();
    expect(afterFailure.world).toEqual(before.world);
    expect(afterFailure.turnNumber).toBe(0);
    expect(afterFailure.turns).toEqual([]);
    expect(afterFailure.nextAgentId).toBe(before.nextAgentId);
    expect(afterFailure).toMatchObject({
      activeAgentId: null,
      status: 'paused',
    });

    const recovered = await simulation.executeNextTurn();
    expect(recovered).toMatchObject({
      turnNumber: 1,
      agentId: before.nextAgentId,
      outcome: 'accepted',
    });
    expect(seenAgentIds).toEqual([before.nextAgentId, before.nextAgentId]);
  });

  it('retains only the newest world events without changing current state', async () => {
    let clock = 0;
    let eventSequence = 0;
    const provider: AgentProvider = {
      mode: 'scripted-test',
      model: 'moving-history-test',
      configured: true,
      async decide(observation): Promise<ProviderDecision> {
        return {
          decision: {
            worldAction: {
              type: 'move',
              targetCell: observation.adjacentCells[0]!.cell,
            },
            summary: 'Move.',
          },
          metadata: {
            provider: 'scripted-test',
            model: 'moving-history-test',
            latencyMs: 0,
          },
        };
      },
    };
    const simulation = new SimulationService({
      provider,
      now: () =>
        new Date(
          Date.parse('2026-08-13T12:00:00.000Z') + clock++,
        ).toISOString(),
      createEventId: () =>
        `67aa21b9-fc78-4b04-9f92-${String(++eventSequence).padStart(12, '0')}`,
    });
    const producedEvents: WorldEvent[] = [];
    let lastRecord: AgentTurnRecord | undefined;

    for (let index = 0; index < 125; index += 1) {
      lastRecord = await simulation.executeNextTurn();
      if (lastRecord.outcome !== 'accepted') {
        throw new Error(
          'The moving history fixture must produce accepted turns.',
        );
      }
      producedEvents.push(lastRecord.worldActionResult.event);
    }

    const snapshot = simulation.getSnapshot();
    expect(snapshot.world.events).toHaveLength(120);
    expect(snapshot.world.events).toEqual(producedEvents.slice(-120));
    expect(
      lastRecord?.observation.recentEvents.map(({ occurredAt }) => occurredAt),
    ).toEqual(producedEvents.slice(-9, -1).map(({ occurredAt }) => occurredAt));

    for (const agent of snapshot.world.agents) {
      const latestMove = producedEvents
        .filter(
          (event) => event.type === 'agent-moved' && event.agentId === agent.id,
        )
        .at(-1);
      expect(latestMove?.type).toBe('agent-moved');
      if (latestMove?.type === 'agent-moved') {
        expect(agent.currentCell).toBe(latestMove.toCell);
      }
    }
  });

  it('prevents overlapping turns and reset during an in-flight request', async () => {
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
    const simulation = service(provider);
    const pending = simulation.executeNextTurn();
    await expect(simulation.executeNextTurn()).rejects.toBeInstanceOf(
      SimulationConflictError,
    );
    expect(() => simulation.reset()).toThrow(SimulationConflictError);
    expect(() =>
      simulation.updateAgentPersonality(
        simulation.getSnapshot().world.agents[0]!.id,
        'Blocked edit.',
      ),
    ).toThrow(SimulationConflictError);
    expect(() => simulation.restoreDefaultPersonalities()).toThrow(
      SimulationConflictError,
    );
    expect(() =>
      simulation.previewExperimentExport(exportRequest('minimal')),
    ).toThrow(SimulationConflictError);
    expect(() =>
      simulation.generateExperimentExport(exportRequest('minimal')),
    ).toThrow(SimulationConflictError);
    release({
      decision: { worldAction: { type: 'wait' }, summary: 'Done.' },
      metadata: {
        provider: 'scripted-test',
        model: 'deferred-test',
        latencyMs: 0,
      },
    });
    await pending;
    expect(simulation.getSnapshot().turnNumber).toBe(1);
  });
});
