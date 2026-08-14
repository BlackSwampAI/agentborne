import { z } from 'zod';

export const MODEL_SUMMARY_MAX_LENGTH = 240;
export const PERSONALITY_MAX_LENGTH = 600;
export const PROVIDER_ERROR_MAX_LENGTH = 240;

export const agentIdSchema = z.uuid().brand<'AgentId'>();
export type AgentId = z.infer<typeof agentIdSchema>;

export const eventIdSchema = z.uuid().brand<'EventId'>();
export type EventId = z.infer<typeof eventIdSchema>;

export const h3CellSchema = z
  .string()
  .regex(/^[0-9a-f]{15}$/i, 'Expected an H3 cell index')
  .brand<'H3Cell'>();
export type H3Cell = z.infer<typeof h3CellSchema>;

export const hexStateSchema = z.enum(['open', 'infected']);
export type HexState = z.infer<typeof hexStateSchema>;

export const personalitySchema = z
  .string()
  .trim()
  .min(1, 'Personality must not be empty.')
  .max(PERSONALITY_MAX_LENGTH);

export const agentProfileSchema = z.object({
  id: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  personality: personalitySchema,
  currentCell: h3CellSchema,
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const agentSchema = agentProfileSchema;
export type Agent = z.infer<typeof agentSchema>;

export const moveActionSchema = z.object({
  type: z.literal('move'),
  targetCell: h3CellSchema,
});
export const infectActionSchema = z.object({ type: z.literal('infect') });
export const messageActionSchema = z.object({
  type: z.literal('message'),
  recipientId: agentIdSchema,
  message: z.string().trim().min(1).max(1_000),
});
export const waitActionSchema = z.object({ type: z.literal('wait') });

/** All engine actions. Messaging remains dormant until Roadmap PR 4. */
export const requestedActionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  infectActionSchema,
  messageActionSchema,
  waitActionSchema,
]);
export type RequestedAction = z.infer<typeof requestedActionSchema>;

/** The deliberately smaller action surface available to PR 2 models. */
export const agentMapActionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  infectActionSchema,
  waitActionSchema,
]);
export type AgentMapAction = z.infer<typeof agentMapActionSchema>;

const worldEventBaseSchema = z.object({
  id: eventIdSchema,
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
});

export const worldEventSchema = z.discriminatedUnion('type', [
  worldEventBaseSchema.extend({
    type: z.literal('agent-moved'),
    fromCell: h3CellSchema,
    toCell: h3CellSchema,
  }),
  worldEventBaseSchema.extend({
    type: z.literal('hex-infected'),
    cell: h3CellSchema,
  }),
  worldEventBaseSchema.extend({
    type: z.literal('agent-messaged'),
    recipientId: agentIdSchema,
    message: z.string().min(1).max(1_000),
  }),
  worldEventBaseSchema.extend({ type: z.literal('agent-waited') }),
]);
export type WorldEvent = z.infer<typeof worldEventSchema>;

export const invalidActionReasonSchema = z.enum([
  'unknown-agent',
  'invalid-action',
  'not-adjacent',
  'cell-not-in-world',
  'already-infected',
  'unknown-recipient',
  'self-message',
  'out-of-range',
]);
export type InvalidActionReason = z.infer<typeof invalidActionReasonSchema>;

export const actionResultSchema = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true), event: worldEventSchema }),
  z.object({
    accepted: z.literal(false),
    reason: invalidActionReasonSchema,
    details: z.string().min(1).max(300),
  }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;

export const worldSnapshotSchema = z.object({
  generatedAt: z.iso.datetime(),
  hexes: z.array(z.object({ cell: h3CellSchema, state: hexStateSchema })),
  agents: z.array(agentSchema),
  events: z.array(worldEventSchema).max(120),
});
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

export const cellObservationSchema = z.object({
  cell: h3CellSchema,
  state: hexStateSchema,
});
export type CellObservation = z.infer<typeof cellObservationSchema>;

export const nearbyAgentObservationSchema = z.object({
  id: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  currentCell: h3CellSchema,
  distance: z.number().int().min(0).max(4),
});

export const publicEventObservationSchema = z.object({
  type: z.enum(['agent-moved', 'hex-infected', 'agent-waited']),
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
  summary: z.string().trim().min(1).max(180),
});

export const agentObservationSchema = z.object({
  agentId: agentIdSchema,
  agentName: z.string().trim().min(1).max(80),
  personality: z.string().trim().min(1).max(PERSONALITY_MAX_LENGTH),
  currentCell: cellObservationSchema,
  adjacentCells: z.array(cellObservationSchema).min(1).max(6),
  nearbyAgents: z.array(nearbyAgentObservationSchema).max(5),
  recentEvents: z.array(publicEventObservationSchema).max(8),
});
export type AgentObservation = z.infer<typeof agentObservationSchema>;

export const agentDecisionSchema = z.object({
  requestedAction: agentMapActionSchema,
  summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const providerModeSchema = z.enum(['openrouter', 'scripted-test']);
export type ProviderMode = z.infer<typeof providerModeSchema>;

export const providerMetadataSchema = z.object({
  provider: providerModeSchema,
  model: z.string().trim().min(1).max(120),
  requestId: z.string().trim().min(1).max(160).optional(),
  latencyMs: z.number().int().nonnegative().max(300_000),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cachedReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costCredits: z.number().nonnegative().finite().optional(),
});
export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;

export const providerFailureSchema = z.object({
  code: z.enum([
    'configuration',
    'timeout',
    'network',
    'provider-http',
    'malformed-response',
    'unsupported-response',
  ]),
  message: z.string().trim().min(1).max(PROVIDER_ERROR_MAX_LENGTH),
  retryable: z.boolean(),
});
export type ProviderFailure = z.infer<typeof providerFailureSchema>;

const turnRecordBaseSchema = z.object({
  turnNumber: z.number().int().positive(),
  agentId: agentIdSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  observation: agentObservationSchema,
});

const completedTurnFields = {
  requestedAction: agentMapActionSchema,
  summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH),
  provider: providerMetadataSchema,
};

export const agentTurnRecordSchema = z.discriminatedUnion('outcome', [
  turnRecordBaseSchema.extend({
    outcome: z.literal('accepted'),
    ...completedTurnFields,
    validation: z.object({ accepted: z.literal(true) }),
    event: worldEventSchema,
  }),
  turnRecordBaseSchema.extend({
    outcome: z.literal('rejected'),
    ...completedTurnFields,
    validation: z.object({
      accepted: z.literal(false),
      reason: invalidActionReasonSchema,
      details: z.string().min(1).max(300),
    }),
  }),
  turnRecordBaseSchema.extend({
    outcome: z.literal('provider-error'),
    failure: providerFailureSchema,
    provider: providerMetadataSchema.optional(),
  }),
]);
export type AgentTurnRecord = z.infer<typeof agentTurnRecordSchema>;

export const simulationStatusSchema = z.enum([
  'paused',
  'running',
  'waiting-for-model',
  'resetting',
  'configuration-error',
  'provider-error',
]);
export type SimulationStatus = z.infer<typeof simulationStatusSchema>;

export const simulationSnapshotSchema = z.object({
  world: worldSnapshotSchema,
  turnNumber: z.number().int().nonnegative(),
  nextAgentId: agentIdSchema,
  activeAgentId: agentIdSchema.nullable(),
  status: simulationStatusSchema,
  providerMode: providerModeSchema,
  providerConfigured: z.boolean(),
  turns: z.array(agentTurnRecordSchema).max(120),
  experiment: z.object({
    id: z.uuid().brand<'ExperimentId'>(),
    startedAt: z.iso.datetime(),
    totalCompletedTurns: z.number().int().nonnegative(),
    retainedTurns: z.number().int().nonnegative(),
    firstRetainedTurn: z.number().int().positive().optional(),
    lastRetainedTurn: z.number().int().positive().optional(),
    droppedRecords: z.number().int().nonnegative(),
    complete: z.boolean(),
    metrics: z.lazy(() => experimentMetricsSchema),
  }),
});
export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;

export const singleTurnResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
  turn: agentTurnRecordSchema,
});
export type SingleTurnResponse = z.infer<typeof singleTurnResponseSchema>;

export const resetSimulationResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
});
export type ResetSimulationResponse = z.infer<
  typeof resetSimulationResponseSchema
>;

export const updateAgentPersonalityRequestSchema = z
  .object({ personality: personalitySchema })
  .strict();
export type UpdateAgentPersonalityRequest = z.infer<
  typeof updateAgentPersonalityRequestSchema
>;

export const updateAgentPersonalityResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
  agent: agentSchema,
});
export type UpdateAgentPersonalityResponse = z.infer<
  typeof updateAgentPersonalityResponseSchema
>;

export const restoreDefaultPersonalitiesResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
});
export type RestoreDefaultPersonalitiesResponse = z.infer<
  typeof restoreDefaultPersonalitiesResponseSchema
>;

export const apiErrorCodeSchema = z.enum([
  'turn_conflict',
  'reset_conflict',
  'personality_conflict',
  'invalid_agent_id',
  'unknown_agent',
  'invalid_personality',
  'invalid_request',
  'invalid_export',
  'export_conflict',
  'records_unavailable',
  'not_found',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(300),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const experimentIdSchema = z.uuid().brand<'ExperimentId'>();
export type ExperimentId = z.infer<typeof experimentIdSchema>;

export const personalityConfigurationEventSchema = z.object({
  timestamp: z.iso.datetime(),
  agentId: agentIdSchema,
  previousPersonality: personalitySchema,
  newPersonality: personalitySchema,
  operation: z.enum(['custom-edit', 'restore-default']),
});
export type PersonalityConfigurationEvent = z.infer<
  typeof personalityConfigurationEventSchema
>;

export const experimentManifestSchema = z.object({
  id: experimentIdSchema,
  startedAt: z.iso.datetime(),
  generatedAt: z.iso.datetime().optional(),
  providerMode: providerModeSchema,
  initialAgents: z.array(agentProfileSchema).length(6).optional(),
});
export type ExperimentManifest = z.infer<typeof experimentManifestSchema>;

export const experimentRetentionSchema = z.object({
  limit: z.number().int().positive(),
  totalCompletedTurns: z.number().int().nonnegative(),
  retainedTurns: z.number().int().nonnegative(),
  firstRetainedTurn: z.number().int().positive().optional(),
  lastRetainedTurn: z.number().int().positive().optional(),
  droppedRecords: z.number().int().nonnegative(),
  complete: z.boolean(),
  requestedRangeExtendsBeyondRetention: z.boolean(),
});
export type ExperimentRetention = z.infer<typeof experimentRetentionSchema>;

export const tokenTotalsSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cachedReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});

export const metricCountsSchema = z.object({
  totalTurns: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  providerErrors: z.number().int().nonnegative(),
  requestedMoves: z.number().int().nonnegative(),
  requestedInfections: z.number().int().nonnegative(),
  requestedWaits: z.number().int().nonnegative(),
  acceptedMovements: z.number().int().nonnegative(),
  successfullyInfectedCells: z.number().int().nonnegative(),
  uniqueVisitedCells: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative().optional(),
  tokens: tokenTotalsSchema,
  knownCostCredits: z.number().nonnegative().finite(),
  turnsWithUnknownCost: z.number().int().nonnegative(),
});
export type MetricCounts = z.infer<typeof metricCountsSchema>;

export const experimentMetricsSchema = z.object({
  aggregate: metricCountsSchema,
  byAgent: z.array(
    z.object({ agentId: agentIdSchema, metrics: metricCountsSchema }),
  ),
});
export type ExperimentMetrics = z.infer<typeof experimentMetricsSchema>;

export const exportOutcomeSchema = z.enum([
  'accepted',
  'rejected',
  'provider-error',
]);
export const exportActionSchema = z.enum(['move', 'infect', 'wait']);
export const exportLevelSchema = z.enum([
  'minimal',
  'standard',
  'full-safe',
  'custom',
]);
export const exportSerializationSchema = z.enum(['compact', 'pretty']);

export const customExportOptionsSchema = z
  .object({
    turnObservations: z.boolean(),
    personalityTextHistory: z.boolean(),
    nearbyAgents: z.boolean(),
    recentEvents: z.boolean(),
    validationDetails: z.boolean(),
    resultingEvents: z.boolean(),
    providerUsageMetadata: z.boolean(),
    initialWorldState: z.boolean(),
    currentWorldState: z.boolean(),
    computedMetrics: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.turnObservations && (value.nearbyAgents || value.recentEvents)) {
      context.addIssue({
        code: 'custom',
        message: 'Nearby agents and recent events require turn observations.',
      });
    }
  });
export type CustomExportOptions = z.infer<typeof customExportOptionsSchema>;

const exportSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      mode: z.literal('selected'),
      agentIds: z.array(agentIdSchema).min(1).max(6),
    })
    .strict()
    .refine((value) => new Set(value.agentIds).size === value.agentIds.length, {
      message: 'Agent IDs must be unique.',
    }),
]);

const exportTurnSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('entire-retained') }).strict(),
  z
    .object({
      mode: z.literal('latest'),
      count: z.union([
        z.literal(10),
        z.literal(25),
        z.literal(50),
        z.literal(120),
      ]),
    })
    .strict(),
  z
    .object({
      mode: z.literal('range'),
      fromTurn: z.number().int().positive(),
      toTurn: z.number().int().positive(),
    })
    .strict()
    .refine((value) => value.fromTurn <= value.toTurn, {
      message: 'The first turn must not exceed the last turn.',
    }),
]);

export const experimentExportRequestSchema = z
  .object({
    agents: exportSelectionSchema,
    turns: exportTurnSelectionSchema,
    outcomes: z.array(exportOutcomeSchema).min(1).max(3),
    actions: z.array(exportActionSchema).min(1).max(3),
    level: exportLevelSchema,
    serialization: exportSerializationSchema.default('compact'),
    custom: customExportOptionsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.outcomes).size !== value.outcomes.length)
      context.addIssue({ code: 'custom', message: 'Outcomes must be unique.' });
    if (new Set(value.actions).size !== value.actions.length)
      context.addIssue({ code: 'custom', message: 'Actions must be unique.' });
    if (value.level === 'custom' && !value.custom)
      context.addIssue({
        code: 'custom',
        message: 'Custom options are required.',
      });
    if (value.level !== 'custom' && value.custom)
      context.addIssue({
        code: 'custom',
        message: 'Custom options are only valid for Custom exports.',
      });
  });
export type ExperimentExportRequest = z.infer<
  typeof experimentExportRequestSchema
>;

export const experimentExportPreviewSchema = z.object({
  experimentId: experimentIdSchema,
  matchingRecordCount: z.number().int().nonnegative(),
  selectedAgentCount: z.number().int().positive().max(6),
  firstMatchingTurn: z.number().int().positive().optional(),
  lastMatchingTurn: z.number().int().positive().optional(),
  retention: experimentRetentionSchema,
  knownCostCredits: z.number().nonnegative().finite(),
  turnsWithUnknownCost: z.number().int().nonnegative(),
  serializedUtf8Bytes: z.number().int().nonnegative(),
  approximateAiInputTokens: z.number().int().nonnegative(),
  tokenEstimateMethod: z.literal('ceil(UTF-8 bytes / 4)'),
});
export type ExperimentExportPreview = z.infer<
  typeof experimentExportPreviewSchema
>;

export const experimentExportTurnSchema = z.object({
  turnNumber: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  agentId: agentIdSchema,
  outcome: exportOutcomeSchema,
  requestedAction: agentMapActionSchema.optional(),
  summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH).optional(),
  validationReason: invalidActionReasonSchema.optional(),
  eventSummary: z.string().trim().min(1).max(300).optional(),
  personality: personalitySchema.optional(),
  observation: agentObservationSchema.partial().optional(),
  validation: z
    .union([
      z.object({ accepted: z.literal(true) }),
      z.object({
        accepted: z.literal(false),
        reason: invalidActionReasonSchema,
        details: z.string().min(1).max(300),
      }),
    ])
    .optional(),
  event: worldEventSchema.optional(),
  failure: providerFailureSchema.optional(),
  provider: providerMetadataSchema.optional(),
});

export const experimentExportWorldStateSchema = worldSnapshotSchema.omit({
  events: true,
});
export type ExperimentExportWorldState = z.infer<
  typeof experimentExportWorldStateSchema
>;

export const experimentExportDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    experiment: experimentManifestSchema,
    retention: experimentRetentionSchema,
    filters: experimentExportRequestSchema,
    selection: z.object({
      selectedAgentIds: z.array(agentIdSchema).min(1).max(6),
      matchingRecordCount: z.number().int().nonnegative(),
      firstMatchingTurn: z.number().int().positive().optional(),
      lastMatchingTurn: z.number().int().positive().optional(),
    }),
    agents: z
      .array(
        agentProfileSchema.omit({ personality: true }).extend({
          personality: personalitySchema.optional(),
        }),
      )
      .min(1)
      .max(6),
    configurationEvents: z
      .array(personalityConfigurationEventSchema)
      .optional(),
    metrics: experimentMetricsSchema.optional(),
    initialWorld: experimentExportWorldStateSchema.optional(),
    currentWorld: experimentExportWorldStateSchema.optional(),
    worldEvents: z.array(worldEventSchema).optional(),
    turns: z.array(experimentExportTurnSchema),
  })
  .superRefine((document, context) => {
    const level = document.filters.level;
    const custom = level === 'custom' ? document.filters.custom : undefined;
    const requiresMetrics = level !== 'custom' || custom?.computedMetrics;
    if (Boolean(document.metrics) !== Boolean(requiresMetrics))
      context.addIssue({
        code: 'custom',
        message: 'Metrics inclusion does not match the export level.',
      });
    const personalityHistory =
      level === 'full-safe' || custom?.personalityTextHistory;
    if (Boolean(document.configurationEvents) !== Boolean(personalityHistory))
      context.addIssue({
        code: 'custom',
        message:
          'Personality history inclusion does not match the export level.',
      });
    const initialWorld = level === 'full-safe' || custom?.initialWorldState;
    const currentWorld = level === 'full-safe' || custom?.currentWorldState;
    if (
      Boolean(document.initialWorld) !== Boolean(initialWorld) ||
      Boolean(document.currentWorld) !== Boolean(currentWorld)
    )
      context.addIssue({
        code: 'custom',
        message: 'World-state inclusion does not match the export level.',
      });
    if (Boolean(document.worldEvents) !== (level === 'full-safe'))
      context.addIssue({
        code: 'custom',
        message: 'World event inclusion does not match the export level.',
      });
    for (const turn of document.turns) {
      const observation =
        level === 'standard' ||
        level === 'full-safe' ||
        custom?.turnObservations;
      const personality =
        level === 'standard' ||
        level === 'full-safe' ||
        custom?.personalityTextHistory;
      const validation =
        level === 'standard' ||
        level === 'full-safe' ||
        custom?.validationDetails;
      const event =
        level === 'standard' ||
        level === 'full-safe' ||
        custom?.resultingEvents;
      const provider = level !== 'custom' || custom?.providerUsageMetadata;
      if (
        Boolean(turn.observation) !== Boolean(observation) ||
        Boolean(turn.personality) !== Boolean(personality)
      )
        context.addIssue({
          code: 'custom',
          message: 'Turn context inclusion does not match the export level.',
        });
      if (
        turn.outcome !== 'provider-error' &&
        Boolean(turn.validation) !== Boolean(validation)
      )
        context.addIssue({
          code: 'custom',
          message: 'Validation inclusion does not match the export level.',
        });
      if (turn.outcome === 'accepted' && Boolean(turn.event) !== Boolean(event))
        context.addIssue({
          code: 'custom',
          message: 'Event inclusion does not match the export level.',
        });
      if (!provider && turn.provider)
        context.addIssue({
          code: 'custom',
          message: 'Provider inclusion does not match the export level.',
        });
    }
  });
export type ExperimentExportDocument = z.infer<
  typeof experimentExportDocumentSchema
>;

export const experimentExportResponseSchema = z.object({
  document: experimentExportDocumentSchema,
});
