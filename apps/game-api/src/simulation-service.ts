import { gridDistance, gridDisk } from 'h3-js';
import {
  AgentProviderError,
  type AgentProvider,
  type ProviderDecision,
} from '@agentborne/agent-runtime';
import {
  agentIdSchema,
  agentObservationSchema,
  agentTurnRecordSchema,
  experimentIdSchema,
  experimentExportDocumentSchema,
  experimentExportPreviewSchema,
  h3CellSchema,
  RECENT_COMMUNICATION_LIMIT,
  RECENT_CONTROL_CHANGE_LIMIT,
  PERSONALITY_MAX_LENGTH,
  personalitySchema,
  simulationSnapshotSchema,
  type Agent,
  type AgentId,
  type AgentObservation,
  type AgentTurnRecord,
  type ExperimentExportDocument,
  type ExperimentExportPreview,
  type ExperimentId,
  type PersonalityConfigurationEvent,
  type H3Cell,
  type ProviderFailure,
  type SimulationSnapshot,
  type SimulationStatus,
  type WorldEvent,
} from '@agentborne/shared';
import {
  applyRequestedAction,
  createDevelopmentWorld,
  DEVELOPMENT_AGENT_BLUEPRINTS,
  getCaptureEligibility,
  toWorldState,
  type WorldState,
} from '@agentborne/world-engine';
import {
  createExperimentExport,
  createExperimentPreview,
  type ExperimentSource,
  ExperimentMetricAccumulator,
} from './experiment-export';

const RESET_GENERATED_AT = '2026-08-13T12:00:00.000Z';
const MAX_TURN_HISTORY = 120;
const MAX_WORLD_EVENT_HISTORY = 120;
const DEFAULT_EXPERIMENT_RETENTION = 5_000;

export class SimulationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationConflictError';
  }
}

export type SimulationValidationCode =
  'invalid_agent_id' | 'unknown_agent' | 'invalid_personality';

export class SimulationValidationError extends Error {
  constructor(
    readonly code: SimulationValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'SimulationValidationError';
  }
}

export interface SimulationServiceOptions {
  provider: AgentProvider;
  now?: () => string;
  createEventId?: () => string;
  createExperimentId?: () => string;
  experimentRetentionLimit?: number;
}

export class SimulationService {
  readonly #provider: AgentProvider;
  readonly #now: () => string;
  readonly #createEventId: () => string;
  readonly #createExperimentId: () => string;
  readonly #experimentRetentionLimit: number;
  #state: WorldState;
  #turns: AgentTurnRecord[] = [];
  #completedTurnCount = 0;
  #cursor = 0;
  #busy = false;
  #status: SimulationStatus;
  #activeAgentId: AgentId | null = null;
  #experimentId: ExperimentId;
  #experimentStartedAt: string;
  #experimentTurns: AgentTurnRecord[] = [];
  #initialExperimentAgents: Agent[];
  #initialExperimentWorld: SimulationSnapshot['world'];
  #configurationEvents: PersonalityConfigurationEvent[] = [];
  #experimentMetrics: ExperimentMetricAccumulator;

  constructor({
    provider,
    now = () => new Date().toISOString(),
    createEventId = () => crypto.randomUUID(),
    createExperimentId = () => crypto.randomUUID(),
    experimentRetentionLimit = DEFAULT_EXPERIMENT_RETENTION,
  }: SimulationServiceOptions) {
    if (
      !Number.isInteger(experimentRetentionLimit) ||
      experimentRetentionLimit < 1
    )
      throw new Error('Experiment retention limit must be a positive integer.');
    this.#provider = provider;
    this.#now = now;
    this.#createEventId = createEventId;
    this.#createExperimentId = createExperimentId;
    this.#experimentRetentionLimit = experimentRetentionLimit;
    this.#state = toWorldState(
      createDevelopmentWorld({ generatedAt: RESET_GENERATED_AT }),
    );
    this.#status = provider.configured ? 'paused' : 'configuration-error';
    this.#experimentId = experimentIdSchema.parse(this.#createExperimentId());
    this.#experimentStartedAt = this.#now();
    this.#initialExperimentAgents = structuredClone([
      ...this.#state.agents.values(),
    ]);
    this.#initialExperimentWorld = this.#worldSnapshot();
    this.#experimentMetrics = new ExperimentMetricAccumulator([
      ...this.#state.agents.keys(),
    ]);
  }

  getSnapshot(): SimulationSnapshot {
    const agents = [...this.#state.agents.values()];
    const next = agents[this.#cursor % agents.length];
    if (!next) throw new Error('The development world has no agents.');
    const droppedRecords =
      this.#completedTurnCount - this.#experimentTurns.length;
    return simulationSnapshotSchema.parse({
      world: this.#worldSnapshot(),
      turnNumber: this.#completedTurnCount,
      nextAgentId: next.id,
      activeAgentId: this.#activeAgentId,
      status: this.#status,
      providerMode: this.#provider.mode,
      providerConfigured: this.#provider.configured,
      turns: this.#turns,
      experiment: {
        id: this.#experimentId,
        startedAt: this.#experimentStartedAt,
        totalCompletedTurns: this.#completedTurnCount,
        retainedTurns: this.#experimentTurns.length,
        firstRetainedTurn: this.#experimentTurns[0]?.turnNumber,
        lastRetainedTurn: this.#experimentTurns.at(-1)?.turnNumber,
        droppedRecords,
        complete: droppedRecords === 0,
        metrics: this.#experimentMetrics.snapshot(agents.map(({ id }) => id)),
        currentTerritory: this.#territoryScoreboard(),
      },
    });
  }

  reset(): SimulationSnapshot {
    if (this.#busy) {
      throw new SimulationConflictError(
        'Reset is unavailable while a model turn is in progress.',
      );
    }
    this.#status = 'resetting';
    const activePersonalities = new Map(
      [...this.#state.agents].map(([id, agent]) => [id, agent.personality]),
    );
    const resetState = toWorldState(
      createDevelopmentWorld({ generatedAt: RESET_GENERATED_AT }),
    );
    this.#state = {
      ...resetState,
      agents: new Map(
        [...resetState.agents].map(([id, agent]) => [
          id,
          {
            ...agent,
            personality: activePersonalities.get(id) ?? agent.personality,
          },
        ]),
      ),
    };
    this.#turns = [];
    this.#completedTurnCount = 0;
    this.#cursor = 0;
    this.#activeAgentId = null;
    this.#experimentId = experimentIdSchema.parse(this.#createExperimentId());
    this.#experimentStartedAt = this.#now();
    this.#experimentTurns = [];
    this.#configurationEvents = [];
    this.#initialExperimentAgents = structuredClone([
      ...this.#state.agents.values(),
    ]);
    this.#initialExperimentWorld = this.#worldSnapshot();
    this.#experimentMetrics = new ExperimentMetricAccumulator([
      ...this.#state.agents.keys(),
    ]);
    this.#status = this.#provider.configured ? 'paused' : 'configuration-error';
    return this.getSnapshot();
  }

  updateAgentPersonality(
    agentIdInput: unknown,
    personalityInput: unknown,
  ): Agent {
    if (this.#busy) {
      throw new SimulationConflictError(
        'Personality changes are unavailable while a model turn is in progress.',
      );
    }
    const agentIdResult = agentIdSchema.safeParse(agentIdInput);
    if (!agentIdResult.success) {
      throw new SimulationValidationError(
        'invalid_agent_id',
        'The agent ID is invalid.',
      );
    }
    const personalityResult = personalitySchema.safeParse(personalityInput);
    if (!personalityResult.success) {
      throw new SimulationValidationError(
        'invalid_personality',
        `Personality must contain 1 to ${PERSONALITY_MAX_LENGTH} characters.`,
      );
    }
    const agent = this.#state.agents.get(agentIdResult.data);
    if (!agent) {
      throw new SimulationValidationError(
        'unknown_agent',
        'The requested agent does not exist.',
      );
    }
    const updated = { ...agent, personality: personalityResult.data };
    const agents = new Map(this.#state.agents);
    agents.set(agent.id, updated);
    this.#state = { ...this.#state, agents };
    if (agent.personality !== updated.personality) {
      this.#configurationEvents = [
        ...this.#configurationEvents,
        {
          timestamp: this.#now(),
          agentId: agent.id,
          previousPersonality: agent.personality,
          newPersonality: updated.personality,
          operation: 'custom-edit',
        },
      ];
    }
    return updated;
  }

  restoreDefaultPersonalities(): SimulationSnapshot {
    if (this.#busy) {
      throw new SimulationConflictError(
        'Personality changes are unavailable while a model turn is in progress.',
      );
    }
    const defaults = new Map(
      DEVELOPMENT_AGENT_BLUEPRINTS.map(({ id, personality }) => [
        agentIdSchema.parse(id),
        personality,
      ]),
    );
    const configurationEvents: PersonalityConfigurationEvent[] = [];
    this.#state = {
      ...this.#state,
      agents: new Map(
        [...this.#state.agents].map(([id, agent]) => {
          const personality = defaults.get(id) ?? agent.personality;
          if (personality !== agent.personality)
            configurationEvents.push({
              timestamp: this.#now(),
              agentId: id,
              previousPersonality: agent.personality,
              newPersonality: personality,
              operation: 'restore-default',
            });
          return [id, { ...agent, personality }];
        }),
      ),
    };
    this.#configurationEvents = [
      ...this.#configurationEvents,
      ...configurationEvents,
    ];
    return this.getSnapshot();
  }

  previewExperimentExport(request: unknown): ExperimentExportPreview {
    if (this.#busy)
      throw new SimulationConflictError(
        'Export is unavailable while a model turn is in progress.',
      );
    return experimentExportPreviewSchema.parse(
      createExperimentPreview(this.#experimentSource(), request, this.#now()),
    );
  }

  generateExperimentExport(request: unknown): ExperimentExportDocument {
    if (this.#busy)
      throw new SimulationConflictError(
        'Export is unavailable while a model turn is in progress.',
      );
    return experimentExportDocumentSchema.parse(
      createExperimentExport(this.#experimentSource(), request, this.#now()),
    );
  }

  async executeNextTurn(): Promise<AgentTurnRecord> {
    if (this.#busy) {
      throw new SimulationConflictError('A model turn is already in progress.');
    }
    const agents = [...this.#state.agents.values()];
    const agent = agents[this.#cursor % agents.length];
    if (!agent) throw new Error('The development world has no agents.');

    this.#busy = true;
    this.#activeAgentId = agent.id;
    this.#status = 'waiting-for-model';

    try {
      const startedAt = this.#now();
      const observation = this.#buildObservation(agent.id);
      const turnNumber = this.#completedTurnCount + 1;
      const providerObservation = structuredClone(observation);
      let providerResult: ProviderDecision;

      try {
        providerResult = await this.#provider.decide(providerObservation);
      } catch (error) {
        const providerError = asProviderError(error);
        const record = agentTurnRecordSchema.parse({
          turnNumber,
          agentId: agent.id,
          startedAt,
          completedAt: this.#now(),
          observation,
          outcome: 'provider-error',
          failure: providerError.failure,
          provider: providerError.metadata,
        });
        this.#commitCompletedTurn(record, this.#state, agents.length);
        this.#status =
          providerError.failure.code === 'configuration'
            ? 'configuration-error'
            : 'provider-error';
        return record;
      }

      const applied = applyRequestedAction(
        this.#state,
        agent.id,
        providerResult.decision.requestedAction,
        { now: this.#now, createEventId: this.#createEventId },
      );
      let record: AgentTurnRecord;
      let candidateState = this.#state;

      if (applied.result.accepted) {
        record = agentTurnRecordSchema.parse({
          turnNumber,
          agentId: agent.id,
          startedAt,
          completedAt: this.#now(),
          observation,
          outcome: 'accepted',
          requestedAction: providerResult.decision.requestedAction,
          summary: providerResult.decision.summary,
          validation: { accepted: true },
          event: applied.result.event,
          provider: providerResult.metadata,
        });
        candidateState = {
          ...applied.state,
          events: applied.state.events.slice(-MAX_WORLD_EVENT_HISTORY),
        };
      } else {
        record = agentTurnRecordSchema.parse({
          turnNumber,
          agentId: agent.id,
          startedAt,
          completedAt: this.#now(),
          observation,
          outcome: 'rejected',
          requestedAction: providerResult.decision.requestedAction,
          summary: providerResult.decision.summary,
          validation: applied.result,
          provider: providerResult.metadata,
        });
      }

      this.#commitCompletedTurn(record, candidateState, agents.length);
      this.#status = 'paused';
      return record;
    } finally {
      this.#busy = false;
      this.#activeAgentId = null;
      if (this.#status === 'waiting-for-model') {
        this.#status = this.#provider.configured
          ? 'paused'
          : 'configuration-error';
      }
    }
  }

  #commitCompletedTurn(
    record: AgentTurnRecord,
    state: WorldState,
    agentCount: number,
  ): void {
    const turns = [...this.#turns, record].slice(-MAX_TURN_HISTORY);
    const cursor = (this.#cursor + 1) % agentCount;

    this.#state = state;
    this.#turns = turns;
    this.#experimentTurns = [
      ...this.#experimentTurns,
      structuredClone(record),
    ].slice(-this.#experimentRetentionLimit);
    this.#experimentMetrics.add(record);
    this.#completedTurnCount = record.turnNumber;
    this.#cursor = cursor;
  }

  #worldSnapshot(): SimulationSnapshot['world'] {
    return {
      generatedAt: RESET_GENERATED_AT,
      hexes: [...this.#state.hexes].map(([cell, hex]) => ({ cell, ...hex })),
      agents: structuredClone([...this.#state.agents.values()]),
      events: structuredClone([...this.#state.events]),
    };
  }

  #experimentSource(): ExperimentSource {
    return {
      id: this.#experimentId,
      startedAt: this.#experimentStartedAt,
      providerMode: this.#provider.mode,
      retentionLimit: this.#experimentRetentionLimit,
      totalCompletedTurns: this.#completedTurnCount,
      turns: this.#experimentTurns,
      initialAgents: this.#initialExperimentAgents,
      currentAgents: [...this.#state.agents.values()],
      configurationEvents: this.#configurationEvents,
      initialWorld: this.#initialExperimentWorld,
      currentWorld: this.#worldSnapshot(),
    };
  }

  #buildObservation(agentId: AgentId): AgentObservation {
    const agent = this.#state.agents.get(agentId);
    if (!agent) throw new Error('The active agent does not exist.');
    const stateFor = (cell: H3Cell) => {
      const state = this.#state.hexes.get(cell);
      if (!state) throw new Error('Observation cell is outside the world.');
      return { cell, ...state };
    };
    const adjacentCells = gridDisk(agent.currentCell, 1)
      .filter((cell) => cell !== agent.currentCell)
      .map((cell) => h3CellSchema.parse(cell))
      .filter((cell) => this.#state.hexes.has(cell))
      .map(stateFor);
    const nearbyAgents = [...this.#state.agents.values()]
      .filter((candidate) => candidate.id !== agent.id)
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        currentCell: candidate.currentCell,
        distance: safeDistance(agent.currentCell, candidate.currentCell),
      }))
      .filter(({ distance }) => distance <= 4)
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .slice(0, 5);
    const recentEvents = this.#state.events
      .filter(
        (event): event is Exclude<WorldEvent, { type: 'agent-messaged' }> =>
          event.type !== 'agent-messaged',
      )
      .slice(-8)
      .map((event) => ({
        type: event.type,
        agentId: event.agentId,
        occurredAt: event.occurredAt,
        summary: summarizeEvent(event, this.#state),
      }));
    const recentCommunications = this.#state.events
      .filter(
        (event): event is Extract<WorldEvent, { type: 'agent-messaged' }> =>
          event.type === 'agent-messaged' &&
          (event.agentId === agent.id || event.recipientId === agent.id),
      )
      .slice(-RECENT_COMMUNICATION_LIMIT)
      .map((event) => {
        const sender = this.#state.agents.get(event.agentId);
        const recipient = this.#state.agents.get(event.recipientId);
        if (!sender || !recipient)
          throw new Error('A communication participant does not exist.');
        return {
          eventId: event.id,
          senderId: sender.id,
          senderName: sender.name,
          recipientId: recipient.id,
          recipientName: recipient.name,
          direction: event.agentId === agent.id ? 'outbound' : 'inbound',
          message: event.message,
          occurredAt: event.occurredAt,
          distance: event.distance,
        } as const;
      });
    const recentControlChanges = this.#state.events
      .filter(
        (event): event is Extract<WorldEvent, { type: 'hex-captured' }> =>
          event.type === 'hex-captured' &&
          (event.controllerAgentId === agent.id ||
            event.previousControllerAgentId === agent.id),
      )
      .slice(-RECENT_CONTROL_CHANGE_LIMIT)
      .map((event) => {
        const gained = event.controllerAgentId === agent.id;
        const otherAgentId = gained
          ? event.previousControllerAgentId
          : event.controllerAgentId;
        const otherAgent = this.#state.agents.get(otherAgentId);
        if (!otherAgent)
          throw new Error('A control-change participant does not exist.');
        return {
          eventId: event.id,
          direction: gained ? ('gained' as const) : ('lost' as const),
          otherAgentId,
          otherAgentName: otherAgent.name,
          cell: event.cell,
          occurredAt: event.occurredAt,
        };
      });
    return agentObservationSchema.parse({
      agentId: agent.id,
      agentName: agent.name,
      personality: agent.personality,
      currentCell: stateFor(agent.currentCell),
      captureEligibility: getCaptureEligibility(this.#state, agent.id),
      adjacentCells,
      nearbyAgents,
      recentEvents,
      recentCommunications,
      territoryScoreboard: this.#territoryScoreboard(),
      recentControlChanges,
    });
  }

  #territoryScoreboard() {
    const counts = new Map<AgentId, number>(
      [...this.#state.agents.keys()].map((id) => [id, 0]),
    );
    for (const hex of this.#state.hexes.values()) {
      if (hex.state === 'infected')
        counts.set(
          hex.controllerAgentId,
          (counts.get(hex.controllerAgentId) ?? 0) + 1,
        );
    }
    return [...this.#state.agents.values()].map(({ id, name, color }) => ({
      agentId: id,
      name,
      color,
      controlledCellCount: counts.get(id) ?? 0,
    }));
  }
}

function safeDistance(from: H3Cell, to: H3Cell): number {
  try {
    return gridDistance(from, to);
  } catch {
    return 99;
  }
}

function summarizeEvent(
  event: Exclude<WorldEvent, { type: 'agent-messaged' }>,
  state: WorldState,
): string {
  const name = state.agents.get(event.agentId)?.name ?? 'An agent';
  if (event.type === 'agent-moved') return `${name} moved to ${event.toCell}.`;
  if (event.type === 'hex-infected') return `${name} infected ${event.cell}.`;
  if (event.type === 'hex-captured') {
    const previous =
      state.agents.get(event.previousControllerAgentId)?.name ??
      'another agent';
    return `${name} captured ${event.cell} from ${previous}.`;
  }
  return `${name} waited.`;
}

function asProviderError(error: unknown): {
  failure: ProviderFailure;
  metadata?: AgentProviderError['metadata'];
} {
  if (error instanceof AgentProviderError) {
    return { failure: error.failure, metadata: error.metadata };
  }
  return {
    failure: {
      code: 'network',
      message: 'The model provider failed unexpectedly.',
      retryable: true,
    },
  };
}
