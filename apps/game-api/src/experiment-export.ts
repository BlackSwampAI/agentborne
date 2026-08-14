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
    addToMutable(this.#records.get('aggregate')!, turn);
    const agent = this.#records.get(turn.agentId);
    if (agent) addToMutable(agent, turn);
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
  requestedWaits: number;
  acceptedMovements: number;
  infections: number;
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
    requestedWaits: 0,
    acceptedMovements: 0,
    infections: 0,
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

function addToMutable(metrics: MutableMetrics, turn: AgentTurnRecord): void {
  metrics.turns += 1;
  metrics[
    turn.outcome === 'provider-error' ? 'providerErrors' : turn.outcome
  ] += 1;
  metrics.visited.add(turn.observation.currentCell.cell);
  if (turn.outcome !== 'provider-error') {
    if (turn.requestedAction.type === 'move') metrics.requestedMoves += 1;
    if (turn.requestedAction.type === 'infect')
      metrics.requestedInfections += 1;
    if (turn.requestedAction.type === 'wait') metrics.requestedWaits += 1;
  }
  if (turn.outcome === 'accepted' && turn.event.type === 'agent-moved') {
    metrics.acceptedMovements += 1;
    metrics.visited.add(turn.event.toCell);
  }
  if (turn.outcome === 'accepted' && turn.event.type === 'hex-infected')
    metrics.infections += 1;
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
    requestedWaits: metrics.requestedWaits,
    acceptedMovements: metrics.acceptedMovements,
    successfullyInfectedCells: metrics.infections,
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
    schemaVersion: 1,
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
      matchingRecordCount: filtered.length,
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
      ? { metrics: calculateExperimentMetrics(filtered, selectedAgentIds) }
      : {}),
    ...(include.initialWorld
      ? { initialWorld: exportWorldState(source.initialWorld) }
      : {}),
    ...(include.currentWorld
      ? { currentWorld: exportWorldState(source.currentWorld) }
      : {}),
    ...(request.level === 'full-safe'
      ? {
          worldEvents: filtered
            .filter(
              (
                turn,
              ): turn is Extract<AgentTurnRecord, { outcome: 'accepted' }> =>
                turn.outcome === 'accepted',
            )
            .map(({ event }) => structuredClone(event)),
        }
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
  );
  return experimentExportPreviewSchema.parse({
    experimentId: source.id,
    matchingRecordCount: document.selection.matchingRecordCount,
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
        request.actions.includes(turn.requestedAction.type)),
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
    };
  if (request.level === 'custom') {
    const custom = request.custom!;
    return {
      personality: custom.personalityTextHistory,
      personalityHistory: custom.personalityTextHistory,
      metrics: custom.computedMetrics,
      initialWorld: custom.initialWorldState,
      currentWorld: custom.currentWorldState,
    };
  }
  return {
    personality: true,
    personalityHistory: false,
    metrics: true,
    initialWorld: false,
    currentWorld: false,
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
          requestedAction: structuredClone(turn.requestedAction),
          summary: turn.summary,
          ...(turn.outcome === 'rejected'
            ? { validationReason: turn.validation.reason }
            : { eventSummary: summarizeEvent(turn.event) }),
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
    base.observation = observation;
  }
  if (turn.outcome !== 'provider-error' && includeValidation)
    base.validation = structuredClone(turn.validation);
  if (turn.outcome === 'accepted' && includeEvent)
    base.event = structuredClone(turn.event);
  if (includeProvider && turn.provider)
    base.provider = full
      ? structuredClone(turn.provider)
      : compactProvider(turn.provider);
  return base;
}

function summarizeEvent(
  event: Extract<AgentTurnRecord, { outcome: 'accepted' }>['event'],
): string {
  if (event.type === 'agent-moved')
    return `Moved from ${event.fromCell} to ${event.toCell}.`;
  if (event.type === 'hex-infected') return `Infected ${event.cell}.`;
  return 'Waited.';
}

export function calculateExperimentMetrics(
  turns: readonly AgentTurnRecord[],
  agentIds: readonly AgentId[],
): ExperimentMetrics {
  const metricFor = (records: readonly AgentTurnRecord[]) => {
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
      if (turn.outcome === 'accepted' && turn.event.type === 'agent-moved')
        visited.add(turn.event.toCell);
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
          turn.outcome !== 'provider-error' &&
          turn.requestedAction.type === 'move',
      ).length,
      requestedInfections: records.filter(
        (turn) =>
          turn.outcome !== 'provider-error' &&
          turn.requestedAction.type === 'infect',
      ).length,
      requestedWaits: records.filter(
        (turn) =>
          turn.outcome !== 'provider-error' &&
          turn.requestedAction.type === 'wait',
      ).length,
      acceptedMovements: records.filter(
        (turn) =>
          turn.outcome === 'accepted' && turn.event.type === 'agent-moved',
      ).length,
      successfullyInfectedCells: records.filter(
        (turn) =>
          turn.outcome === 'accepted' && turn.event.type === 'hex-infected',
      ).length,
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
    aggregate: metricFor(turns),
    byAgent: agentIds.map((agentId) => ({
      agentId,
      metrics: metricFor(turns.filter((turn) => turn.agentId === agentId)),
    })),
  });
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
