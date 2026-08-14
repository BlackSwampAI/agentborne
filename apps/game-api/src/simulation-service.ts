import { gridDistance, gridDisk } from 'h3-js';
import {
  AgentProviderError,
  type AgentProvider,
} from '@agentborne/agent-runtime';
import {
  agentObservationSchema,
  agentTurnRecordSchema,
  h3CellSchema,
  simulationSnapshotSchema,
  type AgentId,
  type AgentObservation,
  type AgentTurnRecord,
  type H3Cell,
  type ProviderFailure,
  type SimulationSnapshot,
  type SimulationStatus,
  type WorldEvent,
} from '@agentborne/shared';
import {
  applyRequestedAction,
  createDevelopmentWorld,
  toWorldState,
  type WorldState,
} from '@agentborne/world-engine';

const RESET_GENERATED_AT = '2026-08-13T12:00:00.000Z';
const MAX_TURN_HISTORY = 120;

export class SimulationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationConflictError';
  }
}

export interface SimulationServiceOptions {
  provider: AgentProvider;
  now?: () => string;
  createEventId?: () => string;
}

export class SimulationService {
  readonly #provider: AgentProvider;
  readonly #now: () => string;
  readonly #createEventId: () => string;
  #state: WorldState;
  #turns: AgentTurnRecord[] = [];
  #cursor = 0;
  #busy = false;
  #status: SimulationStatus;
  #activeAgentId: AgentId | null = null;

  constructor({
    provider,
    now = () => new Date().toISOString(),
    createEventId = () => crypto.randomUUID(),
  }: SimulationServiceOptions) {
    this.#provider = provider;
    this.#now = now;
    this.#createEventId = createEventId;
    this.#state = toWorldState(
      createDevelopmentWorld({ generatedAt: RESET_GENERATED_AT }),
    );
    this.#status = provider.configured ? 'paused' : 'configuration-error';
  }

  getSnapshot(): SimulationSnapshot {
    const agents = [...this.#state.agents.values()];
    const next = agents[this.#cursor % agents.length];
    if (!next) throw new Error('The development world has no agents.');
    return simulationSnapshotSchema.parse({
      world: {
        generatedAt: RESET_GENERATED_AT,
        hexes: [...this.#state.hexes].map(([cell, state]) => ({ cell, state })),
        agents,
        events: this.#state.events,
      },
      turnNumber: this.#turns.length,
      nextAgentId: next.id,
      activeAgentId: this.#activeAgentId,
      status: this.#status,
      providerMode: this.#provider.mode,
      providerConfigured: this.#provider.configured,
      turns: this.#turns,
    });
  }

  reset(): SimulationSnapshot {
    if (this.#busy) {
      throw new SimulationConflictError(
        'Reset is unavailable while a model turn is in progress.',
      );
    }
    this.#status = 'resetting';
    this.#state = toWorldState(
      createDevelopmentWorld({ generatedAt: RESET_GENERATED_AT }),
    );
    this.#turns = [];
    this.#cursor = 0;
    this.#activeAgentId = null;
    this.#status = this.#provider.configured
      ? 'paused'
      : 'configuration-error';
    return this.getSnapshot();
  }

  async executeNextTurn(): Promise<AgentTurnRecord> {
    if (this.#busy) {
      throw new SimulationConflictError(
        'A model turn is already in progress.',
      );
    }
    const agents = [...this.#state.agents.values()];
    const agent = agents[this.#cursor % agents.length];
    if (!agent) throw new Error('The development world has no agents.');

    this.#busy = true;
    this.#activeAgentId = agent.id;
    this.#status = 'waiting-for-model';
    const startedAt = this.#now();
    const observation = this.#buildObservation(agent.id);
    const turnNumber = this.#turns.length + 1;
    let record: AgentTurnRecord;

    try {
      const providerResult = await this.#provider.decide(
        structuredClone(observation),
      );
      const applied = applyRequestedAction(
        this.#state,
        agent.id,
        providerResult.decision.requestedAction,
        { now: this.#now, createEventId: this.#createEventId },
      );
      if (applied.result.accepted) {
        this.#state = applied.state;
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
        this.#status = 'paused';
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
        this.#status = 'paused';
      }
    } catch (error) {
      const providerError = asProviderError(error);
      record = agentTurnRecordSchema.parse({
        turnNumber,
        agentId: agent.id,
        startedAt,
        completedAt: this.#now(),
        observation,
        outcome: 'provider-error',
        failure: providerError.failure,
        provider: providerError.metadata,
      });
      this.#status =
        providerError.failure.code === 'configuration'
          ? 'configuration-error'
          : 'provider-error';
    } finally {
      this.#busy = false;
      this.#activeAgentId = null;
    }

    this.#turns = [...this.#turns, record].slice(-MAX_TURN_HISTORY);
    this.#cursor = (this.#cursor + 1) % agents.length;
    return record;
  }

  #buildObservation(agentId: AgentId): AgentObservation {
    const agent = this.#state.agents.get(agentId);
    if (!agent) throw new Error('The active agent does not exist.');
    const stateFor = (cell: H3Cell) => {
      const state = this.#state.hexes.get(cell);
      if (!state) throw new Error('Observation cell is outside the world.');
      return { cell, state };
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
    return agentObservationSchema.parse({
      agentId: agent.id,
      agentName: agent.name,
      personality: agent.personality,
      currentCell: stateFor(agent.currentCell),
      adjacentCells,
      nearbyAgents,
      recentEvents,
    });
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
  if (event.type === 'hex-infected')
    return `${name} infected ${event.cell}.`;
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
