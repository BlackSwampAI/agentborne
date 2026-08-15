import {
  experimentExportDocumentSchema,
  experimentExportPreviewSchema,
  experimentExportRequestSchema,
  experimentMetricsSchema,
  type Agent,
  type AgentId,
  type AgentObservation,
  type AgentTurnRecord,
  type ExperimentExportDocument,
  type ExperimentExportPreview,
  type ExperimentExportRequest,
  type ExperimentExportWorldState,
  type ExperimentId,
  type ExperimentMetrics,
  type ExportedCommunication,
  type ExportedControlChange,
  type PersonalityConfigurationEvent,
  type ProviderMetadata,
  type WorldSnapshot,
} from '@agentborne/shared';

export interface ExperimentSource {
  id: ExperimentId;
  startedAt: string;
  providerMode: 'openrouter' | 'scripted-test';
  retentionLimit: number;
  totalCompletedTurns: number;
  turns: readonly AgentTurnRecord[];
  initialAgents: readonly Agent[];
  currentAgents: readonly Agent[];
  configurationEvents: readonly PersonalityConfigurationEvent[];
  initialWorld: WorldSnapshot;
  currentWorld: WorldSnapshot;
}

export class ExperimentExportValidationError extends Error {
  constructor(
    readonly code: 'invalid_export' | 'unknown_agent' | 'records_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ExperimentExportValidationError';
  }
}

export class ExperimentMetricAccumulator {
  readonly #records = new Map<AgentId | 'aggregate', MutableMetrics>();

  constructor(agentIds: readonly AgentId[]) {
    this.#records.set('aggregate', mutableMetrics());
    for (const agentId of agentIds)
      this.#records.set(agentId, mutableMetrics());
  }

  add(turn: AgentTurnRecord): void {
    addToMutable(this.#records.get('aggregate')!, turn, true);
    const agent = this.#records.get(turn.agentId);
    if (agent) addToMutable(agent, turn);
    if (
      turn.outcome !== 'provider-error' &&
      turn.communicationResult.requested &&
      turn.communicationResult.accepted &&
      turn.communicationResult.event.channel === 'direct'
    ) {
      const recipient = this.#records.get(
        turn.communicationResult.event.recipientId,
      );
      if (recipient) recipient.directMessagesReceived += 1;
    }
    if (
      turn.outcome === 'accepted' &&
      turn.worldActionResult.event.type === 'hex-captured'
    ) {
      const displaced = this.#records.get(
        turn.worldActionResult.event.previousControllerAgentId,
      );
      if (displaced) displaced.territoryLostThroughCapture += 1;
    }
  }

  snapshot(agentIds: readonly AgentId[]): ExperimentMetrics {
    return experimentMetricsSchema.parse({
      aggregate: finalizeMutable(this.#records.get('aggregate')!),
      byAgent: agentIds.map((agentId) => ({
        agentId,
        metrics: finalizeMutable(
          this.#records.get(agentId) ?? mutableMetrics(),
        ),
      })),
    });
  }
}

const metricTokenFields = [
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'reasoningTokens',
  'cachedReadTokens',
  'cacheWriteTokens',
] as const;

interface MutableMetrics {
  turns: number;
  accepted: number;
  rejected: number;
  providerErrors: number;
  requestedMoves: number;
  requestedInfections: number;
  requestedCaptures: number;
  requestedWaits: number;
  acceptedMovements: number;
  infections: number;
  successfulCaptures: number;
  acceptedWaits: number;
  rejectedWorldActions: number;
  territoryGainedThroughInfection: number;
  territoryGainedThroughCapture: number;
  territoryLostThroughCapture: number;
  publicMessagesRequested: number;
  publicMessagesAccepted: number;
  publicMessagesRejected: number;
  directMessagesRequested: number;
  directMessagesDelivered: number;
  directMessagesRejected: number;
  publicMessagesSent: number;
  directMessagesSent: number;
  directMessagesReceived: number;
  latencyTotal: number;
  latencyCount: number;
  tokens: Record<(typeof metricTokenFields)[number], number>;
  tokenFieldsComplete: Record<(typeof metricTokenFields)[number], boolean>;
  knownCostCredits: string;
  unknownCost: number;
  visited: Set<string>;
}

function mutableMetrics(): MutableMetrics {
  return {
    turns: 0,
    accepted: 0,
    rejected: 0,
    providerErrors: 0,
    requestedMoves: 0,
    requestedInfections: 0,
    requestedCaptures: 0,
    requestedWaits: 0,
    acceptedMovements: 0,
    infections: 0,
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
    latencyTotal: 0,
    latencyCount: 0,
    tokens: Object.fromEntries(
      metricTokenFields.map((field) => [field, 0]),
    ) as MutableMetrics['tokens'],
    tokenFieldsComplete: Object.fromEntries(
      metricTokenFields.map((field) => [field, true]),
    ) as MutableMetrics['tokenFieldsComplete'],
    knownCostCredits: '0',
    unknownCost: 0,
    visited: new Set(),
  };
}

function addToMutable(
  metrics: MutableMetrics,
  turn: AgentTurnRecord,
  aggregate = false,
): void {
  metrics.turns += 1;
  metrics[
    turn.outcome === 'provider-error' ? 'providerErrors' : turn.outcome
  ] += 1;
  metrics.visited.add(turn.observation.currentCell.cell);
  if (turn.outcome !== 'provider-error') {
    if (turn.worldAction.type === 'move') metrics.requestedMoves += 1;
    if (turn.worldAction.type === 'infect') metrics.requestedInfections += 1;
    if (turn.worldAction.type === 'capture') metrics.requestedCaptures += 1;
    if (turn.worldAction.type === 'wait') metrics.requestedWaits += 1;
    if (turn.outcome === 'rejected') metrics.rejectedWorldActions += 1;
    if (turn.communicationResult.requested) {
      const channel = turn.communicationResult.accepted
        ? turn.communicationResult.event.channel
        : turn.communicationResult.attempt.channel;
      if (channel === 'public') metrics.publicMessagesRequested += 1;
      else metrics.directMessagesRequested += 1;
      if (turn.communicationResult.accepted) {
        if (turn.communicationResult.event.channel === 'public') {
          metrics.publicMessagesAccepted += 1;
          metrics.publicMessagesSent += 1;
        } else {
          metrics.directMessagesDelivered += 1;
          metrics.directMessagesSent += 1;
          if (aggregate) metrics.directMessagesReceived += 1;
        }
      } else if (turn.communicationResult.attempt.channel === 'public') {
        metrics.publicMessagesRejected += 1;
      } else metrics.directMessagesRejected += 1;
    }
  }
  if (
    turn.outcome === 'accepted' &&
    turn.worldActionResult.event.type === 'agent-moved'
  ) {
    metrics.acceptedMovements += 1;
    metrics.visited.add(turn.worldActionResult.event.toCell);
  }
  if (
    turn.outcome === 'accepted' &&
    turn.worldActionResult.event.type === 'hex-infected'
  ) {
    metrics.infections += 1;
    metrics.territoryGainedThroughInfection += 1;
  }
  if (
    turn.outcome === 'accepted' &&
    turn.worldActionResult.event.type === 'hex-captured'
  ) {
    metrics.successfulCaptures += 1;
    metrics.territoryGainedThroughCapture += 1;
    if (aggregate) metrics.territoryLostThroughCapture += 1;
  }
  if (
    turn.outcome === 'accepted' &&
    turn.worldActionResult.event.type === 'agent-waited'
  )
    metrics.acceptedWaits += 1;
  if (turn.provider) {
    metrics.latencyTotal += turn.provider.latencyMs;
    metrics.latencyCount += 1;
  }
  for (const field of metricTokenFields) {
    const value = turn.provider?.[field];
    if (value === undefined) metrics.tokenFieldsComplete[field] = false;
    else metrics.tokens[field] += value;
  }
  if (turn.provider?.costCredits === undefined) metrics.unknownCost += 1;
  else
    metrics.knownCostCredits = addDecimalValue(
      metrics.knownCostCredits,
      turn.provider.costCredits,
    );
}

function finalizeMutable(metrics: MutableMetrics) {
  const tokens: Record<string, number> = {};
  if (metrics.turns > 0) {
    for (const field of metricTokenFields)
      if (metrics.tokenFieldsComplete[field])
        tokens[field] = metrics.tokens[field];
  }
  return {
    totalTurns: metrics.turns,
    accepted: metrics.accepted,
    rejected: metrics.rejected,
    providerErrors: metrics.providerErrors,
    requestedMoves: metrics.requestedMoves,
    requestedInfections: metrics.requestedInfections,
    requestedCaptures: metrics.requestedCaptures,
    requestedWaits: metrics.requestedWaits,
    acceptedMovements: metrics.acceptedMovements,
    successfullyInfectedCells: metrics.infections,
    successfulCaptures: metrics.successfulCaptures,
    acceptedWaits: metrics.acceptedWaits,
    rejectedWorldActions: metrics.rejectedWorldActions,
    territoryGainedThroughInfection: metrics.territoryGainedThroughInfection,
    territoryGainedThroughCapture: metrics.territoryGainedThroughCapture,
    territoryLostThroughCapture: metrics.territoryLostThroughCapture,
    publicMessagesRequested: metrics.publicMessagesRequested,
    publicMessagesAccepted: metrics.publicMessagesAccepted,
    publicMessagesRejected: metrics.publicMessagesRejected,
    directMessagesRequested: metrics.directMessagesRequested,
    directMessagesDelivered: metrics.directMessagesDelivered,
    directMessagesRejected: metrics.directMessagesRejected,
    publicMessagesSent: metrics.publicMessagesSent,
    directMessagesSent: metrics.directMessagesSent,
    directMessagesReceived: metrics.directMessagesReceived,
    uniqueVisitedCells: metrics.visited.size,
    ...(metrics.latencyCount > 0
      ? { averageLatencyMs: metrics.latencyTotal / metrics.latencyCount }
      : {}),
    tokens,
    knownCostCredits: Number(metrics.knownCostCredits),
    turnsWithUnknownCost: metrics.unknownCost,
  };
}

export function createExperimentExport(
  source: ExperimentSource,
  requestInput: unknown,
  generatedAt: string,
): ExperimentExportDocument {
  const parsed = experimentExportRequestSchema.safeParse(requestInput);
  if (!parsed.success) {
    throw new ExperimentExportValidationError(
      'invalid_export',
      'The export filters are invalid.',
    );
  }
  const request = parsed.data;
  const selectedAgentIds = resolveAgentIds(source, request);
  const selectedSet = new Set<AgentId>(selectedAgentIds);
  const filtered = filterTurns(source, request, selectedSet);
  const communications = filterCommunications(source, request, selectedSet);
  const controlChanges = filterControlChanges(source, request, selectedSet);
  const firstRetainedTurn = source.turns[0]?.turnNumber;
  const lastRetainedTurn = source.turns.at(-1)?.turnNumber;
  const requestedRangeExtendsBeyondRetention = rangeExtendsBeyondRetention(
    request,
    source,
    firstRetainedTurn,
    lastRetainedTurn,
  );
  const droppedRecords = source.totalCompletedTurns - source.turns.length;
  const retention = {
    limit: source.retentionLimit,
    totalCompletedTurns: source.totalCompletedTurns,
    retainedTurns: source.turns.length,
    firstRetainedTurn,
    lastRetainedTurn,
    droppedRecords,
    complete: droppedRecords === 0,
    requestedRangeExtendsBeyondRetention,
  };
  const include = inclusionsFor(request);
  const selectedAgents = source.currentAgents
    .filter(({ id }) => selectedSet.has(id))
    .map((agent) =>
      include.personality
        ? structuredClone(agent)
        : {
            id: agent.id,
            name: agent.name,
            color: agent.color,
            currentCell: agent.currentCell,
          },
    );
  const document: ExperimentExportDocument = {
    schemaVersion: 4,
    generatedAt,
    experiment: {
      id: source.id,
      startedAt: source.startedAt,
      providerMode: source.providerMode,
      ...(request.level === 'full-safe'
        ? { initialAgents: structuredClone([...source.initialAgents]) }
        : {}),
    },
    retention,
    filters: structuredClone(request),
    selection: {
      selectedAgentIds,
      matchingTurnCount: filtered.length,
      matchingCommunicationCount: communications.length,
      matchingControlChangeCount: controlChanges.length,
      firstMatchingTurn: filtered[0]?.turnNumber,
      lastMatchingTurn: filtered.at(-1)?.turnNumber,
    },
    agents: selectedAgents,
    ...(include.personalityHistory
      ? {
          configurationEvents: source.configurationEvents
            .filter(({ agentId }) => selectedSet.has(agentId))
            .map((event) => structuredClone(event)),
        }
      : {}),
    ...(include.metrics
      ? {
          metrics: calculateExperimentMetrics(
            filtered,
            selectedAgentIds,
            communications,
            controlChanges,
          ),
          currentTerritory: currentTerritory(
            source.currentWorld,
            source.currentAgents,
          ),
        }
      : {}),
    ...(include.initialWorld
      ? { initialWorld: exportWorldState(source.initialWorld) }
      : {}),
    ...(include.currentWorld
      ? { currentWorld: exportWorldState(source.currentWorld) }
      : {}),
    ...(request.level === 'full-safe'
      ? {
          worldEvents: filtered.flatMap((turn) => {
            if (
              turn.outcome !== 'accepted' ||
              turn.worldActionResult.event.type === 'hex-captured'
            )
              return [];
            return [structuredClone(turn.worldActionResult.event)];
          }),
        }
      : {}),
    ...(include.communications
      ? { communications: structuredClone(communications) }
      : {}),
    ...(include.controlChanges
      ? { controlChanges: structuredClone(controlChanges) }
      : {}),
    turns: filtered.map((turn) => exportTurn(turn, request)),
  };
  return experimentExportDocumentSchema.parse(document);
}

function exportWorldState(world: WorldSnapshot): ExperimentExportWorldState {
  return {
    generatedAt: world.generatedAt,
    hexes: structuredClone(world.hexes),
    agents: structuredClone(world.agents),
  };
}

function currentTerritory(world: WorldSnapshot, agents: readonly Agent[]) {
  const counts = new Map<AgentId, number>(agents.map(({ id }) => [id, 0]));
  for (const hex of world.hexes) {
    if (hex.state === 'infected')
      counts.set(
        hex.controllerAgentId,
        (counts.get(hex.controllerAgentId) ?? 0) + 1,
      );
  }
  return agents.map(({ id, name, color }) => ({
    agentId: id,
    name,
    color,
    controlledCellCount: counts.get(id) ?? 0,
  }));
}

export function createExperimentPreview(
  source: ExperimentSource,
  request: unknown,
  generatedAt: string,
): ExperimentExportPreview {
  const document = createExperimentExport(source, request, generatedAt);
  const serialized = serializeExperimentExport(document);
  const serializedUtf8Bytes = new TextEncoder().encode(serialized).byteLength;
  const metrics = calculateExperimentMetrics(
    filterTurns(
      source,
      document.filters,
      new Set(document.selection.selectedAgentIds),
    ),
    document.selection.selectedAgentIds,
    filterCommunications(
      source,
      document.filters,
      new Set(document.selection.selectedAgentIds),
    ),
    filterControlChanges(
      source,
      document.filters,
      new Set(document.selection.selectedAgentIds),
    ),
  );
  return experimentExportPreviewSchema.parse({
    experimentId: source.id,
    matchingTurnCount: document.selection.matchingTurnCount,
    matchingCommunicationCount: document.selection.matchingCommunicationCount,
    matchingControlChangeCount: document.selection.matchingControlChangeCount,
    selectedAgentCount: document.selection.selectedAgentIds.length,
    firstMatchingTurn: document.selection.firstMatchingTurn,
    lastMatchingTurn: document.selection.lastMatchingTurn,
    retention: document.retention,
    knownCostCredits: metrics.aggregate.knownCostCredits,
    turnsWithUnknownCost: metrics.aggregate.turnsWithUnknownCost,
    serializedUtf8Bytes,
    approximateAiInputTokens: Math.ceil(serializedUtf8Bytes / 4),
    tokenEstimateMethod: 'ceil(UTF-8 bytes / 4)',
  });
}

function resolveAgentIds(
  source: ExperimentSource,
  request: ExperimentExportRequest,
): AgentId[] {
  const known = new Set(source.currentAgents.map(({ id }) => id));
  const selected =
    request.agents.mode === 'all'
      ? source.currentAgents.map(({ id }) => id)
      : request.agents.agentIds;
  if (selected.some((id) => !known.has(id))) {
    throw new ExperimentExportValidationError(
      'unknown_agent',
      'One or more selected agents do not exist.',
    );
  }
  return [...selected];
}

function filterTurns(
  source: ExperimentSource,
  request: ExperimentExportRequest,
  selected: Set<AgentId>,
): AgentTurnRecord[] {
  let turns = source.turns.filter(
    (turn) =>
      selected.has(turn.agentId) &&
      request.outcomes.includes(turn.outcome) &&
      (turn.outcome === 'provider-error' ||
        request.actions.includes(turn.worldAction.type)),
  );
  if (request.turns.mode === 'range') {
    const range = request.turns;
    turns = turns.filter(
      ({ turnNumber }) =>
        turnNumber >= range.fromTurn && turnNumber <= range.toTurn,
    );
  } else if (request.turns.mode === 'latest') {
    turns = turns.slice(-request.turns.count);
  }
  return turns.map((turn) => structuredClone(turn));
}

function filterCommunications(
  source: ExperimentSource,
  request: ExperimentExportRequest,
  selected: Set<AgentId>,
): ExportedCommunication[] {
  let communications = source.turns.flatMap((turn) => {
    if (
      turn.outcome === 'provider-error' ||
      !turn.communicationResult.requested
    )
      return [];
    const result = turn.communicationResult;
    const communication = result.accepted ? result.event : result.attempt;
    const selectedByParticipant =
      communication.channel === 'public'
        ? selected.has(communication.agentId)
        : selected.has(communication.agentId) ||
          (communication.recipientId !== null &&
            selected.has(communication.recipientId));
    const selectedByChannel =
      request.communications.channel === 'all' ||
      request.communications.channel === communication.channel;
    const status = result.accepted
      ? ('accepted' as const)
      : ('rejected' as const);
    const selectedByStatus =
      request.communications.status === 'all' ||
      request.communications.status === status;
    if (!selectedByParticipant || !selectedByChannel || !selectedByStatus)
      return [];
    return [
      {
        ...structuredClone(communication),
        originatingTurn: turn.turnNumber,
        status,
        ...(!result.accepted
          ? {
              rejectionReason: result.reason,
              rejectionDetails: result.details,
            }
          : {}),
      },
    ];
  });
  if (request.turns.mode === 'range') {
    const range = request.turns;
    communications = communications.filter(
      ({ originatingTurn }) =>
        originatingTurn >= range.fromTurn && originatingTurn <= range.toTurn,
    );
  } else if (request.turns.mode === 'latest') {
    const firstIncludedTurn = source.turns.at(-request.turns.count)?.turnNumber;
    communications = firstIncludedTurn
      ? communications.filter(
          ({ originatingTurn }) => originatingTurn >= firstIncludedTurn,
        )
      : communications;
  }
  return communications;
}

function filterControlChanges(
  source: ExperimentSource,
  request: ExperimentExportRequest,
  selected: Set<AgentId>,
): ExportedControlChange[] {
  if (
    !request.outcomes.includes('accepted') ||
    !request.actions.includes('capture')
  )
    return [];
  let controlChanges = source.turns.flatMap((turn) => {
    if (
      turn.outcome !== 'accepted' ||
      turn.worldActionResult.event.type !== 'hex-captured' ||
      (!selected.has(turn.worldActionResult.event.controllerAgentId) &&
        !selected.has(turn.worldActionResult.event.previousControllerAgentId))
    )
      return [];
    return [
      {
        ...structuredClone(turn.worldActionResult.event),
        originatingTurn: turn.turnNumber,
      },
    ];
  });
  if (request.turns.mode === 'range') {
    const range = request.turns;
    controlChanges = controlChanges.filter(
      ({ originatingTurn }) =>
        originatingTurn >= range.fromTurn && originatingTurn <= range.toTurn,
    );
  } else if (request.turns.mode === 'latest') {
    controlChanges = controlChanges.slice(-request.turns.count);
  }
  return controlChanges;
}

function rangeExtendsBeyondRetention(
  request: ExperimentExportRequest,
  source: ExperimentSource,
  first?: number,
  last?: number,
): boolean {
  if (request.turns.mode === 'entire-retained')
    return source.totalCompletedTurns > source.turns.length;
  if (request.turns.mode !== 'range') return false;
  if (!first || !last) return true;
  return request.turns.fromTurn < first || request.turns.toTurn > last;
}

function inclusionsFor(request: ExperimentExportRequest) {
  if (request.level === 'full-safe')
    return {
      personality: true,
      personalityHistory: true,
      metrics: true,
      initialWorld: true,
      currentWorld: true,
      communications: true,
      controlChanges: true,
    };
  if (request.level === 'custom') {
    const custom = request.custom!;
    return {
      personality: custom.personalityTextHistory,
      personalityHistory: custom.personalityTextHistory,
      metrics: custom.computedMetrics,
      initialWorld: custom.initialWorldState,
      currentWorld: custom.currentWorldState,
      communications: custom.communications,
      controlChanges: custom.controlChanges,
    };
  }
  return {
    personality: true,
    personalityHistory: false,
    metrics: true,
    initialWorld: false,
    currentWorld: false,
    communications: true,
    controlChanges: true,
  };
}

function compactProvider(provider: ProviderMetadata): ProviderMetadata {
  return {
    provider: provider.provider,
    model: provider.model,
    latencyMs: provider.latencyMs,
    ...(provider.promptTokens === undefined
      ? {}
      : { promptTokens: provider.promptTokens }),
    ...(provider.completionTokens === undefined
      ? {}
      : { completionTokens: provider.completionTokens }),
    ...(provider.totalTokens === undefined
      ? {}
      : { totalTokens: provider.totalTokens }),
    ...(provider.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: provider.reasoningTokens }),
    ...(provider.cachedReadTokens === undefined
      ? {}
      : { cachedReadTokens: provider.cachedReadTokens }),
    ...(provider.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: provider.cacheWriteTokens }),
    ...(provider.costCredits === undefined
      ? {}
      : { costCredits: provider.costCredits }),
  };
}

function exportTurn(
  turn: AgentTurnRecord,
  request: ExperimentExportRequest,
): ExperimentExportDocument['turns'][number] {
  const standard = request.level === 'standard';
  const full = request.level === 'full-safe';
  const custom = request.level === 'custom' ? request.custom! : undefined;
  const includeObservation = full || standard || custom?.turnObservations;
  const includePersonality = full || standard || custom?.personalityTextHistory;
  const includeValidation = full || standard || custom?.validationDetails;
  const includeEvent = full || standard || custom?.resultingEvents;
  const includeProvider =
    request.level !== 'custom' || Boolean(custom?.providerUsageMetadata);
  const base: ExperimentExportDocument['turns'][number] = {
    turnNumber: turn.turnNumber,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    agentId: turn.agentId,
    outcome: turn.outcome,
    ...(turn.outcome === 'provider-error'
      ? { failure: structuredClone(turn.failure) }
      : {
          worldAction: structuredClone(turn.worldAction),
          ...(turn.communication
            ? { communication: structuredClone(turn.communication) }
            : {}),
          summary: turn.summary,
          worldActionSummary: turn.worldActionResult.accepted
            ? summarizeEvent(turn.worldActionResult.event)
            : `Rejected: ${turn.worldActionResult.reason}.`,
          ...(turn.communicationResult.requested
            ? {
                communicationSummary: turn.communicationResult.accepted
                  ? summarizeCommunication(
                      turn.communicationResult.event.channel,
                      turn.communicationResult.event.channel === 'direct'
                        ? turn.communicationResult.event.recipientId
                        : undefined,
                      turn.communicationResult.event.channel === 'direct'
                        ? turn.communicationResult.event.distance
                        : undefined,
                    )
                  : `Rejected: ${turn.communicationResult.reason}.`,
              }
            : {}),
        }),
  };
  if (includePersonality) base.personality = turn.observation.personality;
  if (includeObservation) {
    const observation: Partial<AgentObservation> = structuredClone(
      turn.observation,
    );
    if (!includePersonality) delete observation.personality;
    if (custom && !custom.nearbyAgents) delete observation.nearbyAgents;
    if (custom && !custom.recentEvents) delete observation.recentEvents;
    if (custom && !custom.recentPublicMessages)
      delete observation.recentPublicMessages;
    if (custom && !custom.recentDirectMessages)
      delete observation.recentDirectMessages;
    if (custom && !custom.recentControlChanges)
      delete observation.recentControlChanges;
    base.observation = observation;
  }
  if (
    turn.outcome !== 'provider-error' &&
    (includeValidation || includeEvent)
  ) {
    base.worldActionResult = structuredClone(turn.worldActionResult);
    base.communicationResult = structuredClone(turn.communicationResult);
  }
  if (includeProvider && turn.provider)
    base.provider = full
      ? structuredClone(turn.provider)
      : compactProvider(turn.provider);
  return base;
}

function summarizeEvent(
  event: Extract<
    AgentTurnRecord,
    { outcome: 'accepted' }
  >['worldActionResult']['event'],
): string {
  if (event.type === 'agent-moved')
    return `Moved from ${event.fromCell} to ${event.toCell}.`;
  if (event.type === 'hex-infected') return `Infected ${event.cell}.`;
  if (event.type === 'hex-captured')
    return `Captured ${event.cell} from ${event.previousControllerAgentId}.`;
  return 'Waited.';
}

function summarizeCommunication(
  channel: 'public' | 'direct',
  recipientId?: AgentId,
  distance?: number,
): string {
  return channel === 'public'
    ? 'Published to world chat.'
    : `Delivered directly to ${recipientId} from distance ${distance}.`;
}

export function calculateExperimentMetrics(
  turns: readonly AgentTurnRecord[],
  agentIds: readonly AgentId[],
  communications: readonly ExportedCommunication[] = [],
  controlChanges: readonly ExportedControlChange[] = [],
): ExperimentMetrics {
  const metricFor = (
    records: readonly AgentTurnRecord[],
    relevantCommunications: readonly ExportedCommunication[],
    relevantControlChanges: readonly ExportedControlChange[],
    agentId?: AgentId,
  ) => {
    const latencies = records.flatMap(({ provider }) =>
      provider ? [provider.latencyMs] : [],
    );
    const tokens: Record<string, number> = {};
    for (const field of metricTokenFields) {
      const known = records
        .map(({ provider }) => provider?.[field])
        .filter((value): value is number => value !== undefined);
      if (known.length === records.length && known.length > 0)
        tokens[field] = known.reduce((sum, value) => sum + value, 0);
    }
    const visited = new Set<string>();
    for (const turn of records) {
      visited.add(turn.observation.currentCell.cell);
      if (
        turn.outcome === 'accepted' &&
        turn.worldActionResult.event.type === 'agent-moved'
      )
        visited.add(turn.worldActionResult.event.toCell);
    }
    const costs = records.flatMap(({ provider }) =>
      provider?.costCredits === undefined ? [] : [provider.costCredits],
    );
    return {
      totalTurns: records.length,
      accepted: records.filter(({ outcome }) => outcome === 'accepted').length,
      rejected: records.filter(({ outcome }) => outcome === 'rejected').length,
      providerErrors: records.filter(
        ({ outcome }) => outcome === 'provider-error',
      ).length,
      requestedMoves: records.filter(
        (turn) =>
          turn.outcome !== 'provider-error' && turn.worldAction.type === 'move',
      ).length,
      requestedInfections: records.filter(
        (turn) =>
          turn.outcome !== 'provider-error' &&
          turn.worldAction.type === 'infect',
      ).length,
      requestedCaptures: records.filter(
        (turn) =>
          turn.outcome !== 'provider-error' &&
          turn.worldAction.type === 'capture',
      ).length,
      requestedWaits: records.filter(
        (turn) =>
          turn.outcome !== 'provider-error' && turn.worldAction.type === 'wait',
      ).length,
      acceptedMovements: records.filter(
        (turn) =>
          turn.outcome === 'accepted' &&
          turn.worldActionResult.event.type === 'agent-moved',
      ).length,
      successfullyInfectedCells: records.filter(
        (turn) =>
          turn.outcome === 'accepted' &&
          turn.worldActionResult.event.type === 'hex-infected',
      ).length,
      successfulCaptures: records.filter(
        (turn) =>
          turn.outcome === 'accepted' &&
          turn.worldActionResult.event.type === 'hex-captured',
      ).length,
      acceptedWaits: records.filter(
        (turn) =>
          turn.outcome === 'accepted' &&
          turn.worldActionResult.event.type === 'agent-waited',
      ).length,
      rejectedWorldActions: records.filter(
        ({ outcome }) => outcome === 'rejected',
      ).length,
      territoryGainedThroughInfection: records.filter(
        (turn) =>
          turn.outcome === 'accepted' &&
          turn.worldActionResult.event.type === 'hex-infected',
      ).length,
      territoryGainedThroughCapture: agentId
        ? relevantControlChanges.filter(
            ({ controllerAgentId }) => controllerAgentId === agentId,
          ).length
        : relevantControlChanges.filter(({ controllerAgentId }) =>
            agentIds.includes(controllerAgentId),
          ).length,
      territoryLostThroughCapture: agentId
        ? relevantControlChanges.filter(
            ({ previousControllerAgentId }) =>
              previousControllerAgentId === agentId,
          ).length
        : relevantControlChanges.filter(({ previousControllerAgentId }) =>
            agentIds.includes(previousControllerAgentId),
          ).length,
      ...communicationMetrics(relevantCommunications, agentIds, agentId),
      uniqueVisitedCells: visited.size,
      ...(latencies.length > 0
        ? {
            averageLatencyMs:
              latencies.reduce((sum, value) => sum + value, 0) /
              latencies.length,
          }
        : {}),
      tokens,
      knownCostCredits: sumDecimalNumbers(costs),
      turnsWithUnknownCost: records.filter(
        ({ provider }) => provider?.costCredits === undefined,
      ).length,
    };
  };
  return experimentMetricsSchema.parse({
    aggregate: metricFor(turns, communications, controlChanges),
    byAgent: agentIds.map((agentId) => ({
      agentId,
      metrics: metricFor(
        turns.filter((turn) => turn.agentId === agentId),
        communications,
        controlChanges,
        agentId,
      ),
    })),
  });
}

function communicationMetrics(
  communications: readonly ExportedCommunication[],
  agentIds: readonly AgentId[],
  agentId?: AgentId,
) {
  const authoredBySelection = ({ agentId: senderId }: ExportedCommunication) =>
    agentId ? senderId === agentId : agentIds.includes(senderId);
  const receivedBySelection = (communication: ExportedCommunication) =>
    communication.channel === 'direct' &&
    (agentId
      ? communication.recipientId === agentId
      : communication.recipientId !== undefined &&
        communication.recipientId !== null &&
        agentIds.includes(communication.recipientId));
  const publicAuthored = communications.filter(
    (communication) =>
      communication.channel === 'public' && authoredBySelection(communication),
  );
  const directAuthored = communications.filter(
    (communication) =>
      communication.channel === 'direct' && authoredBySelection(communication),
  );
  return {
    publicMessagesRequested: publicAuthored.length,
    publicMessagesAccepted: publicAuthored.filter(
      ({ status }) => status === 'accepted',
    ).length,
    publicMessagesRejected: publicAuthored.filter(
      ({ status }) => status === 'rejected',
    ).length,
    directMessagesRequested: directAuthored.length,
    directMessagesDelivered: directAuthored.filter(
      ({ status }) => status === 'accepted',
    ).length,
    directMessagesRejected: directAuthored.filter(
      ({ status }) => status === 'rejected',
    ).length,
    publicMessagesSent: publicAuthored.filter(
      ({ status }) => status === 'accepted',
    ).length,
    directMessagesSent: directAuthored.filter(
      ({ status }) => status === 'accepted',
    ).length,
    directMessagesReceived: communications.filter(
      (communication) =>
        communication.status === 'accepted' &&
        receivedBySelection(communication),
    ).length,
  };
}

export function serializeExperimentExport(
  document: ExperimentExportDocument,
): string {
  return document.filters.serialization === 'pretty'
    ? JSON.stringify(document, null, 2)
    : JSON.stringify(document);
}

function addDecimalValue(left: string, right: number): string {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftInteger =
    leftParts.integer * 10n ** BigInt(scale - leftParts.scale);
  const rightInteger =
    rightParts.integer * 10n ** BigInt(scale - rightParts.scale);
  return decimalString(leftInteger + rightInteger, scale);
}

function sumDecimalNumbers(values: readonly number[]): number {
  return Number(values.reduce(addDecimalValue, '0'));
}

function decimalParts(value: number | string): {
  integer: bigint;
  scale: number;
} {
  const [mantissa, exponentText = '0'] = value
    .toString()
    .toLowerCase()
    .split('e');
  const exponent = Number(exponentText);
  const [whole, fraction = ''] = mantissa!.split('.');
  let integer = BigInt(`${whole}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    integer *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { integer, scale };
}

function decimalString(integer: bigint, scale: number): string {
  if (scale === 0) return integer.toString();
  const digits = integer.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
