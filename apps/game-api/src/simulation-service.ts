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
  communicationIntentSchema,
  diplomacyIntentSchema,
  experimentIdSchema,
  experimentExportDocumentSchema,
  experimentExportPreviewSchema,
  experimentModelConfigurationSchema,
  modelSupportsReasoningProfile,
  updateExperimentModelsRequestSchema,
  h3CellSchema,
  RECENT_DIRECT_MESSAGE_LIMIT,
  RECENT_PUBLIC_MESSAGE_LIMIT,
  RECENT_CONTROL_CHANGE_LIMIT,
  RECENT_ALLIANCE_EVENT_LIMIT,
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
  type ExperimentModelConfiguration,
  type CompatibleModel,
  type ModelId,
  type ModelAttempt,
  type ExperimentConfigurationEvent,
  type H3Cell,
  type ProviderFailure,
  type ProviderMetadata,
  type ReasoningProfile,
  type SimulationSnapshot,
  type SimulationStatus,
  type WorldEvent,
  type AllianceEvent,
} from '@agentborne/shared';
import {
  applyCommunication,
  applyDiplomacy,
  applyWorldAction,
  createDevelopmentWorld,
  DEVELOPMENT_AGENT_BLUEPRINTS,
  getCaptureEligibility,
  getAgentAlliance,
  getEffectiveAgentColor,
  expireAllianceProposals,
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

interface PendingFailedTurn {
  turnNumber: number;
  agentId: AgentId;
  startedAt: string;
  observation: AgentObservation;
  failure: ProviderFailure;
  attempts: ModelAttempt[];
}

export class SimulationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationConflictError';
  }
}

export class SimulationTurnCancelledError extends Error {
  constructor() {
    super('The active model request was cancelled without consuming a turn.');
    this.name = 'SimulationTurnCancelledError';
  }
}

export type SimulationValidationCode =
  | 'invalid_agent_id'
  | 'unknown_agent'
  | 'invalid_personality'
  | 'invalid_model_configuration'
  | 'models_unavailable';

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
  createAllianceId?: () => string;
  createProposalId?: () => string;
  experimentRetentionLimit?: number;
}

export class SimulationService {
  readonly #provider: AgentProvider;
  readonly #now: () => string;
  readonly #createEventId: () => string;
  readonly #createExperimentId: () => string;
  readonly #createAllianceId: () => string;
  readonly #createProposalId: () => string;
  readonly #experimentRetentionLimit: number;
  #state: WorldState;
  #turns: AgentTurnRecord[] = [];
  #completedTurnCount = 0;
  #cursor = 0;
  #busy = false;
  #verificationBusy = false;
  #status: SimulationStatus;
  #activeAgentId: AgentId | null = null;
  #activeRequestController: AbortController | null = null;
  #cancellationRequested = false;
  #pendingFailedTurn: PendingFailedTurn | null = null;
  #experimentId: ExperimentId;
  #experimentStartedAt: string;
  #experimentTurns: AgentTurnRecord[] = [];
  #initialExperimentAgents: Agent[];
  #initialExperimentWorld: SimulationSnapshot['world'];
  #configurationEvents: ExperimentConfigurationEvent[] = [];
  #experimentMetrics: ExperimentMetricAccumulator;
  #modelConfiguration: ExperimentModelConfiguration;
  #availableModelIds = new Set<ModelId>();
  #availableModels = new Map<ModelId, CompatibleModel>();

  constructor({
    provider,
    now = () => new Date().toISOString(),
    createEventId = () => crypto.randomUUID(),
    createExperimentId = () => crypto.randomUUID(),
    createAllianceId = () => crypto.randomUUID(),
    createProposalId = () => crypto.randomUUID(),
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
    this.#createAllianceId = createAllianceId;
    this.#createProposalId = createProposalId;
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
    const scriptedModel =
      (provider.model as ModelId | undefined) ??
      (provider.mode === 'scripted-test'
        ? ('deterministic-script' as ModelId)
        : null);
    this.#modelConfiguration = experimentModelConfigurationSchema.parse({
      globalModelId: scriptedModel,
      globalReasoningProfile: 'provider-default',
      overrides: [],
      locked: false,
    });
    if (scriptedModel) this.#availableModelIds.add(scriptedModel);
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
      cancellationRequested: this.#cancellationRequested,
      pendingFailedTurn: this.#pendingFailedTurn
        ? {
            turnNumber: this.#pendingFailedTurn.turnNumber,
            agentId: this.#pendingFailedTurn.agentId,
            failure: this.#pendingFailedTurn.failure,
            attempts: this.#pendingFailedTurn.attempts,
          }
        : null,
      status: this.#status,
      providerMode: this.#provider.mode,
      providerConfigured: this.#provider.configured,
      modelConfiguration: this.#modelConfiguration,
      resolvedModels: agents.map(({ id }) => this.#resolvedModel(id)),
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
        currentAlliances: this.#allianceTerritorySummaries(),
      },
    });
  }

  reset(): SimulationSnapshot {
    if (this.#busy || this.#verificationBusy) {
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
    this.#activeRequestController = null;
    this.#cancellationRequested = false;
    this.#pendingFailedTurn = null;
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
    this.#modelConfiguration = {
      ...this.#modelConfiguration,
      locked: false,
    };
    this.#status = this.#provider.configured ? 'paused' : 'configuration-error';
    return this.getSnapshot();
  }

  setCompatibleModels(models: CompatibleModel[]): void {
    this.#availableModels = new Map(models.map((model) => [model.id, model]));
    this.#availableModelIds = new Set(models.map(({ id }) => id));
    if (this.#provider.mode === 'scripted-test')
      this.#availableModelIds.add('deterministic-script' as ModelId);
  }

  updateModelConfiguration(input: unknown): SimulationSnapshot {
    if (this.#busy || this.#verificationBusy)
      throw new SimulationConflictError(
        'Model changes are unavailable while a model turn is in progress.',
      );
    const parsed = updateExperimentModelsRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new SimulationValidationError(
        'invalid_model_configuration',
        'The model assignment is invalid.',
      );
    const agentIds = new Set(this.#state.agents.keys());
    if (parsed.data.overrides.some(({ agentId }) => !agentIds.has(agentId)))
      throw new SimulationValidationError(
        'unknown_agent',
        'A model override references an unknown agent.',
      );
    const selected = [
      parsed.data.globalModelId,
      ...parsed.data.overrides.map(({ modelId }) => modelId),
    ].filter((modelId): modelId is ModelId => modelId !== null);
    if (selected.some((modelId) => !this.#availableModelIds.has(modelId)))
      throw new SimulationValidationError(
        'models_unavailable',
        'One or more selected models are not in the compatible OpenRouter catalog.',
      );
    if (
      (parsed.data.globalModelId !== null &&
        !modelSupportsReasoningProfile(
          this.#availableModels.get(parsed.data.globalModelId),
          parsed.data.globalReasoningProfile,
        )) ||
      parsed.data.overrides.some(
        ({ modelId, reasoningProfile }) =>
          !modelSupportsReasoningProfile(
            this.#availableModels.get(modelId),
            reasoningProfile,
          ),
      )
    )
      throw new SimulationValidationError(
        'invalid_model_configuration',
        'A selected reasoning profile is not advertised by its model.',
      );
    const nextConfiguration = experimentModelConfigurationSchema.parse({
      ...parsed.data,
      locked: false,
    });
    this.#recordModelConfigurationChanges(
      this.#modelConfiguration,
      nextConfiguration,
    );
    this.#modelConfiguration = nextConfiguration;
    return this.getSnapshot();
  }

  importModelConfiguration(document: unknown): {
    snapshot: SimulationSnapshot;
    legacy: boolean;
    message: string;
  } {
    if (this.#busy || this.#verificationBusy)
      throw new SimulationConflictError(
        'Import is unavailable while a model request is active.',
      );
    if (
      typeof document !== 'object' ||
      document === null ||
      Array.isArray(document)
    )
      throw new SimulationValidationError(
        'invalid_model_configuration',
        'The experiment import is invalid.',
      );
    const root = document as Record<string, unknown>;
    const version = root.schemaVersion;
    if (version !== 5 && version !== 6 && version !== 7)
      throw new SimulationValidationError(
        'invalid_model_configuration',
        'Only schema-version 5, 6, or 7 experiment exports can be imported.',
      );
    if (version === 5) {
      const legacyConfiguration: ExperimentModelConfiguration = {
        globalModelId: null,
        globalReasoningProfile: 'provider-default',
        overrides: [],
        locked: false,
      };
      this.#recordModelConfigurationChanges(
        this.#modelConfiguration,
        legacyConfiguration,
      );
      this.#modelConfiguration = legacyConfiguration;
      return {
        snapshot: this.getSnapshot(),
        legacy: true,
        message:
          'Legacy experiment preserved. Select compatible models before continuing.',
      };
    }
    const experiment =
      typeof root.experiment === 'object' && root.experiment !== null
        ? (root.experiment as Record<string, unknown>)
        : undefined;
    const configuration = experimentModelConfigurationSchema.safeParse(
      experiment?.modelConfiguration,
    );
    if (!configuration.success)
      throw new SimulationValidationError(
        'invalid_model_configuration',
        'The imported model assignment is invalid.',
      );
    const knownAgents = new Set(this.#state.agents.keys());
    if (
      configuration.data.overrides.some(
        ({ agentId }) => !knownAgents.has(agentId),
      )
    )
      throw new SimulationValidationError(
        'unknown_agent',
        'The imported model assignment references an unknown agent.',
      );
    const importedConfiguration: ExperimentModelConfiguration = {
      globalModelId: configuration.data.globalModelId,
      globalReasoningProfile: configuration.data.globalReasoningProfile,
      overrides: structuredClone(configuration.data.overrides),
      locked: false,
    };
    this.#recordModelConfigurationChanges(
      this.#modelConfiguration,
      importedConfiguration,
    );
    this.#modelConfiguration = importedConfiguration;
    return {
      snapshot: this.getSnapshot(),
      legacy: false,
      message: this.getSnapshot().resolvedModels.every(
        ({ available }) => available,
      )
        ? 'Model assignments imported.'
        : 'Model assignments imported; unavailable models or reasoning profiles require explicit replacement.',
    };
  }

  updateAgentPersonality(
    agentIdInput: unknown,
    personalityInput: unknown,
  ): Agent {
    if (this.#busy || this.#verificationBusy) {
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
    if (this.#busy || this.#verificationBusy) {
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
    const configurationEvents: ExperimentConfigurationEvent[] = [];
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
    if (this.#busy || this.#verificationBusy)
      throw new SimulationConflictError(
        'Export is unavailable while a model turn is in progress.',
      );
    return experimentExportPreviewSchema.parse(
      createExperimentPreview(this.#experimentSource(), request, this.#now()),
    );
  }

  generateExperimentExport(request: unknown): ExperimentExportDocument {
    if (this.#busy || this.#verificationBusy)
      throw new SimulationConflictError(
        'Export is unavailable while a model turn is in progress.',
      );
    return experimentExportDocumentSchema.parse(
      createExperimentExport(this.#experimentSource(), request, this.#now()),
    );
  }

  cancelCurrentRequest(): SimulationSnapshot {
    if (!this.#busy || !this.#activeRequestController)
      throw new SimulationConflictError(
        'There is no active model request to cancel.',
      );
    this.#cancellationRequested = true;
    this.#activeRequestController.abort();
    return this.getSnapshot();
  }

  async verifyModel(
    modelId: ModelId,
    reasoningProfile: ReasoningProfile,
  ): Promise<ProviderMetadata> {
    if (this.#busy || this.#verificationBusy)
      throw new SimulationConflictError(
        'A provider request is already in progress.',
      );
    const model = this.#availableModels.get(modelId);
    if (!model)
      throw new SimulationValidationError(
        'models_unavailable',
        'The selected model is not in the compatible OpenRouter catalog.',
      );
    if (!modelSupportsReasoningProfile(model, reasoningProfile))
      throw new SimulationValidationError(
        'invalid_model_configuration',
        'The selected reasoning profile is not advertised by this model.',
      );
    const agents = [...this.#state.agents.values()];
    const agent = agents[this.#cursor % agents.length];
    if (!agent) throw new Error('The development world has no agents.');
    this.#verificationBusy = true;
    try {
      const result = await this.#provider.decide(
        structuredClone(this.#buildObservation(agent.id)),
        modelId,
        { reasoningProfile },
      );
      return result.metadata;
    } finally {
      this.#verificationBusy = false;
    }
  }

  async executeNextTurn(): Promise<AgentTurnRecord> {
    if (this.#pendingFailedTurn)
      throw new SimulationConflictError(
        'The failed turn must be retried or skipped before starting another turn.',
      );
    return this.#executeTurnAttempt('initial');
  }

  async retryFailedTurn(): Promise<AgentTurnRecord> {
    if (!this.#pendingFailedTurn)
      throw new SimulationConflictError(
        'There is no failed turn awaiting a manual retry.',
      );
    return this.#executeTurnAttempt('manual-retry');
  }

  skipFailedTurn(): AgentTurnRecord {
    if (this.#busy || this.#verificationBusy)
      throw new SimulationConflictError('A model request is still active.');
    const pending = this.#pendingFailedTurn;
    if (!pending)
      throw new SimulationConflictError(
        'There is no failed turn awaiting an operator decision.',
      );
    const agents = [...this.#state.agents.values()];
    const record = agentTurnRecordSchema.parse({
      turnNumber: pending.turnNumber,
      agentId: pending.agentId,
      startedAt: pending.startedAt,
      completedAt: this.#now(),
      observation: pending.observation,
      outcome: 'operator-skipped',
      failure: pending.failure,
      provider: pending.attempts.at(-1)?.provider,
      modelAttempts: pending.attempts,
      allianceEvents: [],
    });
    this.#pendingFailedTurn = null;
    this.#commitCompletedTurn(record, this.#state, agents.length);
    this.#status = 'paused';
    return record;
  }

  async #executeTurnAttempt(
    attemptKind: 'initial' | 'manual-retry',
  ): Promise<AgentTurnRecord> {
    if (this.#busy || this.#verificationBusy) {
      throw new SimulationConflictError('A model turn is already in progress.');
    }
    const agents = [...this.#state.agents.values()];
    const unresolved = agents
      .map(({ id }) => this.#resolvedModel(id))
      .filter(({ available }) => !available);
    if (unresolved.length)
      throw new SimulationValidationError(
        'models_unavailable',
        'Every agent requires an available compatible model before the experiment can run.',
      );
    const pending = this.#pendingFailedTurn;
    const agent = pending
      ? agents.find(({ id }) => id === pending.agentId)
      : agents[this.#cursor % agents.length];
    if (!agent) throw new Error('The development world has no agents.');

    this.#busy = true;
    this.#activeAgentId = agent.id;
    this.#activeRequestController = new AbortController();
    this.#cancellationRequested = false;
    this.#status = 'waiting-for-model';
    const startedAt = pending?.startedAt ?? this.#now();
    const observation =
      pending?.observation ?? this.#buildObservation(agent.id);
    const turnNumber = pending?.turnNumber ?? this.#completedTurnCount + 1;
    const attemptStartedAt = this.#now();
    const resolvedModel = this.#resolvedModel(agent.id);
    const selectedModel = resolvedModel.modelId!;
    let providerResult: ProviderDecision | undefined;

    try {
      const providerObservation = structuredClone(observation);

      try {
        providerResult = await this.#provider.decide(
          providerObservation,
          selectedModel,
          {
            reasoningProfile: resolvedModel.reasoningProfile,
            signal: this.#activeRequestController.signal,
          },
        );
        if (this.#activeRequestController.signal.aborted)
          throw new AgentProviderError({
            code: 'cancelled',
            message: 'The model request was cancelled by the operator.',
            retryable: false,
            model: selectedModel,
          });
      } catch (error) {
        const providerError = asProviderError(error);
        if (providerError.failure.code === 'cancelled') {
          this.#status = 'paused';
          throw new SimulationTurnCancelledError();
        }
        const attemptProvider = providerError.metadata ?? {
          provider: this.#provider.mode,
          model: providerError.failure.model ?? selectedModel,
          latencyMs: providerError.failure.latencyMs ?? 0,
        };
        const attempt = {
          attemptNumber: (pending?.attempts.length ?? 0) + 1,
          kind: attemptKind,
          startedAt: attemptStartedAt,
          completedAt: this.#now(),
          modelId: selectedModel,
          reasoningProfile: resolvedModel.reasoningProfile,
          failure: providerError.failure,
          provider: attemptProvider,
        } satisfies ModelAttempt;
        const attempts = [...(pending?.attempts ?? []), attempt];
        this.#pendingFailedTurn = {
          turnNumber,
          agentId: agent.id,
          startedAt,
          observation,
          failure: providerError.failure,
          attempts,
        };
        const record = agentTurnRecordSchema.parse({
          turnNumber,
          agentId: agent.id,
          startedAt,
          completedAt: this.#now(),
          observation,
          outcome: 'provider-error',
          failure: providerError.failure,
          provider: attemptProvider,
          modelAttempts: attempts,
          allianceEvents: [],
        });
        this.#status =
          providerError.failure.code === 'configuration'
            ? 'configuration-error'
            : 'provider-error';
        return record;
      }

      if (!providerResult)
        throw new Error('The provider completed without a decision result.');

      const preActionState = this.#state;
      const occurredAt = this.#now();
      const communicationInput =
        providerResult.decision.communication ?? undefined;
      const diplomacyInput = providerResult.decision.diplomacy ?? undefined;
      const parsedCommunication =
        communicationIntentSchema.safeParse(communicationInput);
      const communication = parsedCommunication.success
        ? parsedCommunication.data
        : undefined;
      const parsedDiplomacy = diplomacyIntentSchema.safeParse(diplomacyInput);
      const diplomacy = parsedDiplomacy.success
        ? parsedDiplomacy.data
        : undefined;
      const context = {
        now: () => occurredAt,
        createEventId: this.#createEventId,
        createAllianceId: this.#createAllianceId,
        createProposalId: this.#createProposalId,
      };
      const appliedAction = applyWorldAction(
        preActionState,
        agent.id,
        providerResult.decision.worldAction,
        context,
      );
      const appliedCommunication = applyCommunication(
        appliedAction.state,
        preActionState,
        agent.id,
        communicationInput,
        context,
      );
      const appliedDiplomacy = applyDiplomacy(
        appliedCommunication.state,
        agent.id,
        diplomacyInput,
        turnNumber,
        context,
      );
      const stateAfterExpiration = expireAllianceProposals(
        appliedDiplomacy.state,
        turnNumber,
        context,
      );
      const candidateState = {
        ...stateAfterExpiration,
        events: stateAfterExpiration.events.slice(-MAX_WORLD_EVENT_HISTORY),
      };

      const completed = {
        turnNumber,
        agentId: agent.id,
        startedAt,
        completedAt: this.#now(),
        observation,
        worldAction: providerResult.decision.worldAction,
        communication,
        diplomacy,
        summary: providerResult.decision.summary,
        worldActionResult: appliedAction.result,
        communicationResult: appliedCommunication.result,
        diplomacyResult: appliedDiplomacy.result,
        allianceEvents: allianceEventsSince(
          preActionState,
          stateAfterExpiration,
        ),
        provider: providerResult.metadata,
        modelAttempts: [
          ...(pending?.attempts ?? []),
          {
            attemptNumber: (pending?.attempts.length ?? 0) + 1,
            kind: attemptKind,
            startedAt: attemptStartedAt,
            completedAt: this.#now(),
            modelId: selectedModel,
            reasoningProfile: resolvedModel.reasoningProfile,
            provider: providerResult.metadata,
          },
        ],
      };
      const record = agentTurnRecordSchema.parse(
        appliedAction.result.accepted
          ? {
              ...completed,
              outcome: 'accepted',
              worldActionResult: appliedAction.result,
            }
          : {
              ...completed,
              outcome: 'rejected',
              worldActionResult: appliedAction.result,
            },
      );

      this.#pendingFailedTurn = null;
      this.#commitCompletedTurn(record, candidateState, agents.length);
      this.#status = 'paused';
      return record;
    } catch (error) {
      if (
        error instanceof SimulationTurnCancelledError ||
        !(error instanceof Error) ||
        error.name !== 'ZodError'
      )
        throw error;
      const failure: ProviderFailure = {
        code: 'simulation-validation',
        message: 'The model decision failed post-provider validation.',
        retryable: true,
        model: selectedModel,
      };
      const attempt = {
        attemptNumber: (pending?.attempts.length ?? 0) + 1,
        kind: attemptKind,
        startedAt: attemptStartedAt,
        completedAt: this.#now(),
        modelId: selectedModel,
        reasoningProfile: resolvedModel.reasoningProfile,
        failure,
        provider: {
          provider: this.#provider.mode,
          model: selectedModel,
          latencyMs: 0,
        },
      } satisfies ModelAttempt;
      const attempts = [...(pending?.attempts ?? []), attempt];
      this.#pendingFailedTurn = {
        turnNumber,
        agentId: agent.id,
        startedAt,
        observation,
        failure,
        attempts,
      };
      this.#status = 'provider-error';
      return agentTurnRecordSchema.parse({
        turnNumber,
        agentId: agent.id,
        startedAt,
        completedAt: this.#now(),
        observation,
        outcome: 'provider-error',
        failure,
        provider: attempt.provider,
        modelAttempts: attempts,
        allianceEvents: [],
      });
    } finally {
      this.#busy = false;
      this.#activeAgentId = null;
      this.#activeRequestController = null;
      this.#cancellationRequested = false;
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
    this.#modelConfiguration = { ...this.#modelConfiguration, locked: false };
  }

  #recordModelConfigurationChanges(
    previous: ExperimentModelConfiguration,
    next: ExperimentModelConfiguration,
  ): void {
    const timestamp = this.#now();
    const effectiveTurn = this.#completedTurnCount + 1;
    const events: ExperimentConfigurationEvent[] = [];
    if (
      previous.globalModelId !== next.globalModelId ||
      previous.globalReasoningProfile !== next.globalReasoningProfile
    )
      events.push({
        type: 'model-assignment-changed',
        timestamp,
        scope: 'global',
        previousModelId: previous.globalModelId,
        newModelId: next.globalModelId,
        previousReasoningProfile: previous.globalReasoningProfile,
        newReasoningProfile: next.globalReasoningProfile,
        effectiveTurn,
      });
    const previousOverrides = new Map(
      previous.overrides.map((override) => [override.agentId, override]),
    );
    const nextOverrides = new Map(
      next.overrides.map((override) => [override.agentId, override]),
    );
    for (const agentId of new Set([
      ...previousOverrides.keys(),
      ...nextOverrides.keys(),
    ])) {
      const previousOverride = previousOverrides.get(agentId);
      const nextOverride = nextOverrides.get(agentId);
      if (
        previousOverride?.modelId === nextOverride?.modelId &&
        previousOverride?.reasoningProfile === nextOverride?.reasoningProfile
      )
        continue;
      events.push({
        type: 'model-assignment-changed',
        timestamp,
        scope: 'agent',
        agentId,
        previousModelId: previousOverride?.modelId ?? previous.globalModelId,
        newModelId: nextOverride?.modelId ?? next.globalModelId,
        previousReasoningProfile:
          previousOverride?.reasoningProfile ?? previous.globalReasoningProfile,
        newReasoningProfile:
          nextOverride?.reasoningProfile ?? next.globalReasoningProfile,
        effectiveTurn,
      });
    }
    this.#configurationEvents = [...this.#configurationEvents, ...events];
  }

  #worldSnapshot(): SimulationSnapshot['world'] {
    return {
      generatedAt: RESET_GENERATED_AT,
      hexes: [...this.#state.hexes].map(([cell, hex]) => ({ cell, ...hex })),
      agents: structuredClone([...this.#state.agents.values()]),
      events: structuredClone([...this.#state.events]),
      alliances: structuredClone([...(this.#state.alliances?.values() ?? [])]),
      pendingAllianceProposals: structuredClone([
        ...(this.#state.pendingAllianceProposals?.values() ?? []),
      ]),
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
      modelConfiguration: this.#modelConfiguration,
    };
  }

  #resolvedModel(agentId: AgentId) {
    const override = this.#modelConfiguration.overrides.find(
      (candidate) => candidate.agentId === agentId,
    );
    const modelId = override?.modelId ?? this.#modelConfiguration.globalModelId;
    const reasoningProfile =
      override?.reasoningProfile ??
      this.#modelConfiguration.globalReasoningProfile;
    const source = override
      ? ('override' as const)
      : modelId
        ? ('global' as const)
        : ('missing' as const);
    const modelAvailable =
      modelId !== null && this.#availableModelIds.has(modelId);
    const reasoningAvailable = modelSupportsReasoningProfile(
      modelId === null ? undefined : this.#availableModels.get(modelId),
      reasoningProfile,
    );
    const available = modelAvailable && reasoningAvailable;
    return {
      agentId,
      modelId,
      reasoningProfile,
      source,
      available,
      ...(modelId === null
        ? { issue: 'missing' as const }
        : !modelAvailable
          ? { issue: 'unavailable' as const }
          : available
            ? {}
            : { issue: 'reasoning-unavailable' as const }),
    };
  }

  #buildObservation(agentId: AgentId): AgentObservation {
    const agent = this.#state.agents.get(agentId);
    if (!agent) throw new Error('The active agent does not exist.');
    const stateFor = (cell: H3Cell) => {
      const state = this.#state.hexes.get(cell);
      if (!state) throw new Error('Observation cell is outside the world.');
      if (state.state === 'open')
        return {
          cell,
          ...state,
          controllerAllianceId: null,
          effectiveColor: null,
        } as const;
      return {
        cell,
        ...state,
        controllerAllianceId:
          getAgentAlliance(this.#state, state.controllerAgentId)?.id ?? null,
        effectiveColor: getEffectiveAgentColor(
          this.#state,
          state.controllerAgentId,
        ),
      } as const;
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
        allianceId: getAgentAlliance(this.#state, candidate.id)?.id ?? null,
      }))
      .filter(({ distance }) => distance <= 4)
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .slice(0, 7);
    const recentEvents = this.#state.events
      .filter(
        (
          event,
        ): event is Extract<
          WorldEvent,
          {
            type:
              'agent-moved' | 'hex-infected' | 'hex-captured' | 'agent-waited';
          }
        > =>
          event.type === 'agent-moved' ||
          event.type === 'hex-infected' ||
          event.type === 'hex-captured' ||
          event.type === 'agent-waited',
      )
      .slice(-8)
      .map((event) => ({
        type: event.type,
        agentId: event.agentId,
        occurredAt: event.occurredAt,
        summary: summarizeEvent(event, this.#state),
      }));
    const recentPublicMessages = this.#state.events
      .filter(
        (
          event,
        ): event is Extract<WorldEvent, { type: 'public-message-sent' }> =>
          event.type === 'public-message-sent',
      )
      .slice(-RECENT_PUBLIC_MESSAGE_LIMIT)
      .map((event) => {
        const sender = this.#state.agents.get(event.agentId);
        if (!sender) throw new Error('A public-message sender does not exist.');
        return {
          eventId: event.id,
          senderId: sender.id,
          senderName: sender.name,
          message: event.message,
          occurredAt: event.occurredAt,
        };
      });
    const recentDirectMessages = this.#state.events
      .filter(
        (
          event,
        ): event is Extract<WorldEvent, { type: 'direct-message-sent' }> =>
          event.type === 'direct-message-sent' &&
          (event.agentId === agent.id || event.recipientId === agent.id),
      )
      .slice(-RECENT_DIRECT_MESSAGE_LIMIT)
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
      recentPublicMessages,
      recentDirectMessages,
      territoryScoreboard: this.#territoryScoreboard(),
      actingAllianceId: getAgentAlliance(this.#state, agent.id)?.id ?? null,
      actingAlliance:
        this.#allianceTerritorySummaries().find(
          ({ allianceId }) =>
            allianceId === getAgentAlliance(this.#state, agent.id)?.id,
        ) ?? null,
      activeAlliances: this.#allianceTerritorySummaries(),
      inboundAllianceProposals: [
        ...(this.#state.pendingAllianceProposals?.values() ?? []),
      ].filter(({ recipientAgentId }) => recipientAgentId === agent.id),
      outboundAllianceProposals: [
        ...(this.#state.pendingAllianceProposals?.values() ?? []),
      ].filter(({ proposerAgentId }) => proposerAgentId === agent.id),
      recentAllianceEvents: this.#state.events
        .filter(isAllianceEvent)
        .slice(-RECENT_ALLIANCE_EVENT_LIMIT)
        .map((event) => ({
          event,
          summary: summarizeAllianceEvent(event, this.#state),
        })),
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
      allianceId: getAgentAlliance(this.#state, id)?.id ?? null,
      effectiveColor: getEffectiveAgentColor(this.#state, id),
      controlledCellCount: counts.get(id) ?? 0,
    }));
  }

  #allianceTerritorySummaries() {
    const scoreboard = this.#territoryScoreboard();
    return [...(this.#state.alliances?.values() ?? [])].map((alliance) => {
      const members = alliance.memberAgentIds.map((agentId) => {
        const entry = scoreboard.find(
          (candidate) => candidate.agentId === agentId,
        );
        if (!entry) throw new Error('An alliance member does not exist.');
        return {
          agentId,
          name: entry.name,
          controlledCellCount: entry.controlledCellCount,
        };
      });
      return {
        allianceId: alliance.id,
        color: alliance.color,
        totalControlledCellCount: members.reduce(
          (sum, member) => sum + member.controlledCellCount,
          0,
        ),
        members,
      };
    });
  }
}

function isAllianceEvent(event: WorldEvent): event is AllianceEvent {
  return (
    event.type.startsWith('alliance-') ||
    event.type === 'agent-joined-alliance' ||
    event.type === 'agent-left-alliance'
  );
}

function allianceEventsSince(
  before: WorldState,
  after: WorldState,
): AllianceEvent[] {
  return after.events.slice(before.events.length).filter(isAllianceEvent);
}

function safeDistance(from: H3Cell, to: H3Cell): number {
  try {
    return gridDistance(from, to);
  } catch {
    return 99;
  }
}

function summarizeEvent(
  event: Extract<
    WorldEvent,
    {
      type: 'agent-moved' | 'hex-infected' | 'hex-captured' | 'agent-waited';
    }
  >,
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

function summarizeAllianceEvent(
  event: AllianceEvent,
  state: WorldState,
): string {
  const name = (id: AgentId) => state.agents.get(id)?.name ?? 'An agent';
  if (event.type === 'alliance-proposed')
    return `${name(event.agentId)} proposed an alliance with ${name(event.recipientAgentId)}.`;
  if (event.type === 'alliance-formed')
    return `${event.memberAgentIds.map(name).join(' and ')} formed an alliance.`;
  if (event.type === 'agent-joined-alliance')
    return `${name(event.joinedAgentId)} joined the alliance.`;
  if (event.type === 'agent-left-alliance')
    return `${name(event.leftAgentId)} left the alliance.`;
  if (event.type === 'alliance-dissolved') return 'The alliance dissolved.';
  return `The proposal from ${name(event.proposerAgentId)} to ${name(event.recipientAgentId)} was ${event.reason}.`;
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
