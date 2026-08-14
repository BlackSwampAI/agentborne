import { z } from 'zod';

export const MODEL_SUMMARY_MAX_LENGTH = 240;
export const MESSAGE_MAX_LENGTH = 280;
export const MESSAGE_RANGE = 3;
export const RECENT_COMMUNICATION_LIMIT = 6;
export const RECENT_CONTROL_CHANGE_LIMIT = 6;
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

export const hexSchema = z.discriminatedUnion('state', [
  z.object({
    cell: h3CellSchema,
    state: z.literal('open'),
    controllerAgentId: z.null(),
  }),
  z.object({
    cell: h3CellSchema,
    state: z.literal('infected'),
    controllerAgentId: agentIdSchema,
  }),
]);
export type Hex = z.infer<typeof hexSchema>;

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
export const captureActionSchema = z
  .object({ type: z.literal('capture') })
  .strict();
export const messageContentSchema = z
  .string()
  .trim()
  .min(1)
  .max(MESSAGE_MAX_LENGTH);
export const messageActionSchema = z.object({
  type: z.literal('message'),
  recipientId: agentIdSchema,
  message: messageContentSchema,
});
export const waitActionSchema = z.object({ type: z.literal('wait') });

export const requestedActionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  infectActionSchema,
  captureActionSchema,
  messageActionSchema,
  waitActionSchema,
]);
export type RequestedAction = z.infer<typeof requestedActionSchema>;
export const agentTurnActionSchema = requestedActionSchema;
export type AgentTurnAction = z.infer<typeof agentTurnActionSchema>;

const worldEventBaseSchema = z.object({
  id: eventIdSchema,
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
});

export const acceptedMessageEventSchema = worldEventBaseSchema.extend({
  type: z.literal('agent-messaged'),
  recipientId: agentIdSchema,
  message: messageContentSchema,
  distance: z.number().int().min(0).max(MESSAGE_RANGE),
});
export type AcceptedMessageEvent = z.infer<typeof acceptedMessageEventSchema>;

const agentMovedWorldEventSchema = worldEventBaseSchema.extend({
  type: z.literal('agent-moved'),
  fromCell: h3CellSchema,
  toCell: h3CellSchema,
});
const hexInfectedWorldEventSchema = worldEventBaseSchema.extend({
  type: z.literal('hex-infected'),
  cell: h3CellSchema,
  controllerAgentId: agentIdSchema,
});
export const hexCapturedWorldEventSchema = worldEventBaseSchema.extend({
  type: z.literal('hex-captured'),
  cell: h3CellSchema,
  controllerAgentId: agentIdSchema,
  previousControllerAgentId: agentIdSchema,
});
export type HexCapturedWorldEvent = z.infer<typeof hexCapturedWorldEventSchema>;
const agentWaitedWorldEventSchema = worldEventBaseSchema.extend({
  type: z.literal('agent-waited'),
});

export const nonCommunicationWorldEventSchema = z.discriminatedUnion('type', [
  agentMovedWorldEventSchema,
  hexInfectedWorldEventSchema,
  hexCapturedWorldEventSchema,
  agentWaitedWorldEventSchema,
]);
export type NonCommunicationWorldEvent = z.infer<
  typeof nonCommunicationWorldEventSchema
>;

export const worldEventSchema = z.discriminatedUnion('type', [
  agentMovedWorldEventSchema,
  hexInfectedWorldEventSchema,
  hexCapturedWorldEventSchema,
  acceptedMessageEventSchema,
  agentWaitedWorldEventSchema,
]);
export type WorldEvent = z.infer<typeof worldEventSchema>;

export const invalidActionReasonSchema = z.enum([
  'unknown-agent',
  'invalid-action',
  'not-adjacent',
  'cell-not-in-world',
  'already-infected',
  'capture-open-cell',
  'already-controller',
  'controller-present',
  'unknown-recipient',
  'self-message',
  'out-of-range',
]);
export type InvalidActionReason = z.infer<typeof invalidActionReasonSchema>;

export const captureBlockedReasonSchema = z.enum([
  'capture-open-cell',
  'already-controller',
  'controller-present',
]);
export type CaptureBlockedReason = z.infer<typeof captureBlockedReasonSchema>;

export const captureEligibilitySchema = z.discriminatedUnion('eligible', [
  z.object({ eligible: z.literal(true) }).strict(),
  z
    .object({
      eligible: z.literal(false),
      blockedReason: captureBlockedReasonSchema,
    })
    .strict(),
]);
export type CaptureEligibility = z.infer<typeof captureEligibilitySchema>;

export const actionResultSchema = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true), event: worldEventSchema }),
  z.object({
    accepted: z.literal(false),
    reason: invalidActionReasonSchema,
    details: z.string().min(1).max(300),
  }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;

const worldSnapshotObjectSchema = z.object({
  generatedAt: z.iso.datetime(),
  hexes: z.array(hexSchema),
  agents: z.array(agentSchema),
  events: z.array(worldEventSchema).max(120),
});

function validateWorldControllers(
  world: Pick<z.infer<typeof worldSnapshotObjectSchema>, 'hexes' | 'agents'>,
  context: z.RefinementCtx,
): void {
  const agentIds = new Set(world.agents.map(({ id }) => id));
  for (const [index, hex] of world.hexes.entries()) {
    if (hex.state === 'infected' && !agentIds.has(hex.controllerAgentId))
      context.addIssue({
        code: 'custom',
        path: ['hexes', index, 'controllerAgentId'],
        message: 'An infected hex controller must be a world agent.',
      });
  }
}

export const worldSnapshotSchema = worldSnapshotObjectSchema.superRefine(
  validateWorldControllers,
);
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

export const cellObservationSchema = hexSchema;
export type CellObservation = z.infer<typeof cellObservationSchema>;

export const nearbyAgentObservationSchema = z.object({
  id: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  currentCell: h3CellSchema,
  distance: z.number().int().min(0).max(4),
});

export const publicEventObservationSchema = z.object({
  type: z.enum(['agent-moved', 'hex-infected', 'hex-captured', 'agent-waited']),
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
  summary: z.string().trim().min(1).max(180),
});

export const observedCommunicationSchema = z.object({
  eventId: eventIdSchema,
  senderId: agentIdSchema,
  senderName: z.string().trim().min(1).max(80),
  recipientId: agentIdSchema,
  recipientName: z.string().trim().min(1).max(80),
  direction: z.enum(['inbound', 'outbound']),
  message: messageContentSchema,
  occurredAt: z.iso.datetime(),
  distance: z.number().int().min(0).max(MESSAGE_RANGE),
});
export type ObservedCommunication = z.infer<typeof observedCommunicationSchema>;

export const territoryScoreboardEntrySchema = z.object({
  agentId: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  controlledCellCount: z.number().int().nonnegative().max(61),
});
export const territoryScoreboardSchema = z
  .array(territoryScoreboardEntrySchema)
  .length(6)
  .refine(
    (entries) => new Set(entries.map(({ agentId }) => agentId)).size === 6,
    { message: 'Territory scoreboard agent IDs must be unique.' },
  );
export type TerritoryScoreboard = z.infer<typeof territoryScoreboardSchema>;

export const observedControlChangeSchema = z.object({
  eventId: eventIdSchema,
  direction: z.enum(['gained', 'lost']),
  otherAgentId: agentIdSchema,
  otherAgentName: z.string().trim().min(1).max(80),
  cell: h3CellSchema,
  occurredAt: z.iso.datetime(),
});
export type ObservedControlChange = z.infer<typeof observedControlChangeSchema>;

export const agentObservationSchema = z.object({
  agentId: agentIdSchema,
  agentName: z.string().trim().min(1).max(80),
  personality: z.string().trim().min(1).max(PERSONALITY_MAX_LENGTH),
  currentCell: cellObservationSchema,
  captureEligibility: captureEligibilitySchema,
  adjacentCells: z.array(cellObservationSchema).min(1).max(6),
  nearbyAgents: z.array(nearbyAgentObservationSchema).max(5),
  recentEvents: z.array(publicEventObservationSchema).max(8),
  recentCommunications: z
    .array(observedCommunicationSchema)
    .max(RECENT_COMMUNICATION_LIMIT),
  territoryScoreboard: territoryScoreboardSchema,
  recentControlChanges: z
    .array(observedControlChangeSchema)
    .max(RECENT_CONTROL_CHANGE_LIMIT),
});
export type AgentObservation = z.infer<typeof agentObservationSchema>;

export const agentDecisionSchema = z.object({
  requestedAction: agentTurnActionSchema,
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
  requestedAction: agentTurnActionSchema,
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

export const simulationSnapshotSchema = z
  .object({
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
      currentTerritory: territoryScoreboardSchema,
    }),
  })
  .superRefine((snapshot, context) => {
    const authoritative = new Map<AgentId, number>(
      snapshot.world.agents.map(({ id }) => [id, 0]),
    );
    for (const hex of snapshot.world.hexes) {
      if (hex.state === 'infected')
        authoritative.set(
          hex.controllerAgentId,
          (authoritative.get(hex.controllerAgentId) ?? 0) + 1,
        );
    }
    for (const [
      index,
      entry,
    ] of snapshot.experiment.currentTerritory.entries()) {
      const agent = snapshot.world.agents.find(
        ({ id }) => id === entry.agentId,
      );
      if (!agent || agent.name !== entry.name || agent.color !== entry.color)
        context.addIssue({
          code: 'custom',
          path: ['experiment', 'currentTerritory', index],
          message: 'Current territory identity must match a world agent.',
        });
      if (authoritative.get(entry.agentId) !== entry.controlledCellCount)
        context.addIssue({
          code: 'custom',
          path: [
            'experiment',
            'currentTerritory',
            index,
            'controlledCellCount',
          ],
          message: 'Current territory must match authoritative world control.',
        });
    }
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

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  checkedAt: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
  requestedCaptures: z.number().int().nonnegative(),
  requestedMessages: z.number().int().nonnegative(),
  requestedWaits: z.number().int().nonnegative(),
  acceptedMovements: z.number().int().nonnegative(),
  successfullyInfectedCells: z.number().int().nonnegative(),
  successfulCaptures: z.number().int().nonnegative(),
  territoryGainedThroughInfection: z.number().int().nonnegative(),
  territoryGainedThroughCapture: z.number().int().nonnegative(),
  territoryLostThroughCapture: z.number().int().nonnegative(),
  deliveredMessages: z.number().int().nonnegative(),
  sentCommunications: z.number().int().nonnegative(),
  receivedCommunications: z.number().int().nonnegative(),
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
export const exportActionSchema = z.enum([
  'move',
  'infect',
  'capture',
  'message',
  'wait',
]);
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
    recentCommunications: z.boolean(),
    recentControlChanges: z.boolean(),
    validationDetails: z.boolean(),
    resultingEvents: z.boolean(),
    providerUsageMetadata: z.boolean(),
    initialWorldState: z.boolean(),
    currentWorldState: z.boolean(),
    computedMetrics: z.boolean(),
    communications: z.boolean(),
    controlChanges: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.turnObservations &&
      (value.nearbyAgents ||
        value.recentEvents ||
        value.recentCommunications ||
        value.recentControlChanges)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Nearby agents, recent events, recent communications, and recent control changes require turn observations.',
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
    actions: z.array(exportActionSchema).min(1).max(5),
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
  matchingCommunicationCount: z.number().int().nonnegative(),
  matchingControlChangeCount: z.number().int().nonnegative(),
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
  requestedAction: agentTurnActionSchema.optional(),
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

export const experimentExportWorldStateSchema = worldSnapshotObjectSchema
  .omit({ events: true })
  .superRefine(validateWorldControllers);

export const exportedCommunicationSchema = acceptedMessageEventSchema.extend({
  originatingTurn: z.number().int().positive(),
});
export const exportedControlChangeSchema = hexCapturedWorldEventSchema.extend({
  originatingTurn: z.number().int().positive(),
});
export type ExportedControlChange = z.infer<typeof exportedControlChangeSchema>;
export type ExportedCommunication = z.infer<typeof exportedCommunicationSchema>;
export type ExperimentExportWorldState = z.infer<
  typeof experimentExportWorldStateSchema
>;

export const experimentExportDocumentSchema = z
  .object({
    schemaVersion: z.literal(3),
    generatedAt: z.iso.datetime(),
    experiment: experimentManifestSchema,
    retention: experimentRetentionSchema,
    filters: experimentExportRequestSchema,
    selection: z.object({
      selectedAgentIds: z.array(agentIdSchema).min(1).max(6),
      matchingRecordCount: z.number().int().nonnegative(),
      matchingCommunicationCount: z.number().int().nonnegative(),
      matchingControlChangeCount: z.number().int().nonnegative(),
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
    currentTerritory: territoryScoreboardSchema.optional(),
    initialWorld: experimentExportWorldStateSchema.optional(),
    currentWorld: experimentExportWorldStateSchema.optional(),
    worldEvents: z.array(nonCommunicationWorldEventSchema).optional(),
    communications: z.array(exportedCommunicationSchema).optional(),
    controlChanges: z.array(exportedControlChangeSchema).optional(),
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
    if (Boolean(document.currentTerritory) !== Boolean(requiresMetrics))
      context.addIssue({
        code: 'custom',
        message: 'Current territory inclusion does not match the export level.',
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
    const communications = level !== 'custom' || custom?.communications;
    if (Boolean(document.communications) !== Boolean(communications))
      context.addIssue({
        code: 'custom',
        message: 'Communication inclusion does not match the export level.',
      });
    const controlChanges = level !== 'custom' || custom?.controlChanges;
    if (Boolean(document.controlChanges) !== Boolean(controlChanges))
      context.addIssue({
        code: 'custom',
        message: 'Control-change inclusion does not match the export level.',
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
