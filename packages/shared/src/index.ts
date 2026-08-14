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
