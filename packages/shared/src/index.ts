import { z } from 'zod';

export const MODEL_SUMMARY_MAX_LENGTH = 240;
export const MESSAGE_MAX_LENGTH = 280;
export const MESSAGE_RANGE = 3;
export const RECENT_PUBLIC_MESSAGE_LIMIT = 12;
export const RECENT_DIRECT_MESSAGE_LIMIT = 6;
export const RECENT_CONTROL_CHANGE_LIMIT = 6;
export const RECENT_ALLIANCE_EVENT_LIMIT = 8;
export const PERSONALITY_MAX_LENGTH = 600;
export const PROVIDER_ERROR_MAX_LENGTH = 240;
export const OPENROUTER_MODEL_CONTEXT_MINIMUM = 16_384;
export const OPENROUTER_MAX_OUTPUT_TOKENS = 4_096;
export const OPENROUTER_PROVIDER_TIMEOUT_MS = 75_000;
export const OPENROUTER_429_FALLBACK_BACKOFF_MS = 1_500;
export const AGENT_DECISION_CONTRACT_VERSION = 'text-flat-json-v1';
export const OPENROUTER_REQUIRED_PARAMETERS = ['max_tokens'] as const;
export const DEVELOPMENT_WORLD_CONFIG = {
  latitude: 41.6528,
  longitude: -83.5379,
  resolution: 9,
  radius: 6,
  cellCount: 127,
  agentCount: 8,
} as const;
export const ALLIANCE_PROPOSAL_DURATION_TURNS = 8;
export const ALLIANCE_COLOR_PALETTE = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
] as const;

export const agentIdSchema = z.uuid().brand<'AgentId'>();
export type AgentId = z.infer<typeof agentIdSchema>;

export const eventIdSchema = z.uuid().brand<'EventId'>();
export type EventId = z.infer<typeof eventIdSchema>;

export const allianceIdSchema = z.uuid().brand<'AllianceId'>();
export type AllianceId = z.infer<typeof allianceIdSchema>;
export const allianceProposalIdSchema = z.uuid().brand<'AllianceProposalId'>();
export type AllianceProposalId = z.infer<typeof allianceProposalIdSchema>;
export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

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
  color: colorSchema,
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
export const publicCommunicationSchema = z
  .object({
    channel: z.literal('public'),
    message: messageContentSchema,
  })
  .strict();
export const directCommunicationSchema = z
  .object({
    channel: z.literal('direct'),
    recipientId: agentIdSchema,
    message: messageContentSchema,
  })
  .strict();
export const communicationIntentSchema = z.discriminatedUnion('channel', [
  publicCommunicationSchema,
  directCommunicationSchema,
]);
export type CommunicationIntent = z.infer<typeof communicationIntentSchema>;

export const diplomacyIntentSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('propose-alliance'), recipientId: agentIdSchema })
    .strict(),
  z
    .object({
      type: z.literal('accept-alliance'),
      proposalId: allianceProposalIdSchema,
    })
    .strict(),
  z.object({ type: z.literal('leave-alliance') }).strict(),
]);
export type DiplomacyIntent = z.infer<typeof diplomacyIntentSchema>;

export const allianceSchema = z.object({
  id: allianceIdSchema,
  color: z.enum(ALLIANCE_COLOR_PALETTE),
  memberAgentIds: z
    .array(agentIdSchema)
    .min(2)
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Alliance members must be unique.',
    }),
});
export type Alliance = z.infer<typeof allianceSchema>;

export const allianceProposalSchema = z
  .object({
    id: allianceProposalIdSchema,
    proposerAgentId: agentIdSchema,
    recipientAgentId: agentIdSchema,
    proposerAllianceId: allianceIdSchema.nullable(),
    originatingTurn: z.number().int().positive(),
    expirationTurn: z.number().int().positive(),
  })
  .strict()
  .refine(
    (proposal) => proposal.proposerAgentId !== proposal.recipientAgentId,
    {
      message: 'Alliance proposal participants must be distinct.',
    },
  );
export type AllianceProposal = z.infer<typeof allianceProposalSchema>;

export const waitActionSchema = z.object({ type: z.literal('wait') });

export const worldActionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  infectActionSchema,
  captureActionSchema,
  waitActionSchema,
]);
export type WorldAction = z.infer<typeof worldActionSchema>;
export const agentTurnActionSchema = worldActionSchema;
export type AgentTurnAction = WorldAction;

const directMessageFields = {
  recipientId: agentIdSchema,
  message: messageContentSchema,
  distance: z.number().int().nonnegative().nullable(),
};

const worldEventBaseSchema = z.object({
  id: eventIdSchema,
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
});

export const publicMessageEventSchema = worldEventBaseSchema.extend({
  type: z.literal('public-message-sent'),
  channel: z.literal('public'),
  message: messageContentSchema,
});
export const directMessageEventSchema = worldEventBaseSchema.extend({
  type: z.literal('direct-message-sent'),
  channel: z.literal('direct'),
  ...directMessageFields,
  distance: z.number().int().min(0).max(MESSAGE_RANGE),
});
export const communicationEventSchema = z.discriminatedUnion('channel', [
  publicMessageEventSchema,
  directMessageEventSchema,
]);
export type CommunicationEvent = z.infer<typeof communicationEventSchema>;

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

const allianceEventBaseSchema = worldEventBaseSchema.extend({
  turnNumber: z.number().int().positive(),
});
export const allianceProposedEventSchema = allianceEventBaseSchema.extend({
  type: z.literal('alliance-proposed'),
  proposalId: allianceProposalIdSchema,
  recipientAgentId: agentIdSchema,
  allianceId: allianceIdSchema.nullable(),
  expirationTurn: z.number().int().positive(),
});
export const allianceProposalClosedEventSchema = allianceEventBaseSchema.extend(
  {
    type: z.literal('alliance-proposal-closed'),
    proposalId: allianceProposalIdSchema,
    proposerAgentId: agentIdSchema,
    recipientAgentId: agentIdSchema,
    reason: z.enum(['expired', 'invalidated']),
  },
);
export const allianceFormedEventSchema = allianceEventBaseSchema.extend({
  type: z.literal('alliance-formed'),
  allianceId: allianceIdSchema,
  allianceColor: z.enum(ALLIANCE_COLOR_PALETTE),
  memberAgentIds: z.array(agentIdSchema).length(2),
});
export const agentJoinedAllianceEventSchema = allianceEventBaseSchema.extend({
  type: z.literal('agent-joined-alliance'),
  allianceId: allianceIdSchema,
  allianceColor: z.enum(ALLIANCE_COLOR_PALETTE),
  joinedAgentId: agentIdSchema,
  memberAgentIds: z
    .array(agentIdSchema)
    .min(2)
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
});
export const agentLeftAllianceEventSchema = allianceEventBaseSchema.extend({
  type: z.literal('agent-left-alliance'),
  allianceId: allianceIdSchema,
  allianceColor: z.enum(ALLIANCE_COLOR_PALETTE),
  leftAgentId: agentIdSchema,
  remainingMemberAgentIds: z
    .array(agentIdSchema)
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
});
export const allianceDissolvedEventSchema = allianceEventBaseSchema.extend({
  type: z.literal('alliance-dissolved'),
  allianceId: allianceIdSchema,
  allianceColor: z.enum(ALLIANCE_COLOR_PALETTE),
  formerMemberAgentIds: z
    .array(agentIdSchema)
    .min(1)
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
});
export const allianceEventSchema = z.discriminatedUnion('type', [
  allianceProposedEventSchema,
  allianceProposalClosedEventSchema,
  allianceFormedEventSchema,
  agentJoinedAllianceEventSchema,
  agentLeftAllianceEventSchema,
  allianceDissolvedEventSchema,
]);
export type AllianceEvent = z.infer<typeof allianceEventSchema>;

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
  publicMessageEventSchema,
  directMessageEventSchema,
  agentWaitedWorldEventSchema,
  allianceProposedEventSchema,
  allianceProposalClosedEventSchema,
  allianceFormedEventSchema,
  agentJoinedAllianceEventSchema,
  agentLeftAllianceEventSchema,
  allianceDissolvedEventSchema,
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
  'allied-controller',
]);
export type InvalidActionReason = z.infer<typeof invalidActionReasonSchema>;

export const captureBlockedReasonSchema = z.enum([
  'capture-open-cell',
  'already-controller',
  'controller-present',
  'allied-controller',
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

export const worldActionResultSchema = z.discriminatedUnion('accepted', [
  z.object({
    accepted: z.literal(true),
    event: nonCommunicationWorldEventSchema,
  }),
  z.object({
    accepted: z.literal(false),
    reason: invalidActionReasonSchema,
    details: z.string().min(1).max(300),
  }),
]);
export type WorldActionResult = z.infer<typeof worldActionResultSchema>;
export const actionResultSchema = worldActionResultSchema;
export type ActionResult = WorldActionResult;

export const communicationRejectionReasonSchema = z.enum([
  'invalid-communication',
  'unknown-recipient',
  'self-message',
  'out-of-range',
]);
export type CommunicationRejectionReason = z.infer<
  typeof communicationRejectionReasonSchema
>;

const communicationAttemptBaseSchema = z.object({
  id: eventIdSchema,
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
  message: messageContentSchema,
});
export const communicationAttemptSchema = z.discriminatedUnion('channel', [
  communicationAttemptBaseSchema.extend({ channel: z.literal('public') }),
  communicationAttemptBaseSchema.extend({
    channel: z.literal('direct'),
    recipientId: agentIdSchema.nullable(),
    distance: z.number().int().nonnegative().nullable(),
  }),
]);
export type CommunicationAttempt = z.infer<typeof communicationAttemptSchema>;

export const communicationResultSchema = z.union([
  z.object({ requested: z.literal(false) }).strict(),
  z.object({
    requested: z.literal(true),
    accepted: z.literal(true),
    event: communicationEventSchema,
  }),
  z.object({
    requested: z.literal(true),
    accepted: z.literal(false),
    attempt: communicationAttemptSchema,
    reason: communicationRejectionReasonSchema,
    details: z.string().min(1).max(300),
  }),
]);
export type CommunicationResult = z.infer<typeof communicationResultSchema>;

export const diplomacyRejectionReasonSchema = z.enum([
  'invalid-diplomacy',
  'unknown-recipient',
  'self-proposal',
  'recipient-allied',
  'current-ally',
  'outgoing-proposal-exists',
  'incoming-proposal-exists',
  'unknown-proposal',
  'not-proposal-recipient',
  'stale-proposal',
  'not-allied',
  'alliance-capacity',
]);
export type DiplomacyRejectionReason = z.infer<
  typeof diplomacyRejectionReasonSchema
>;
export const diplomacyAttemptSchema = z.object({
  type: z.enum([
    'propose-alliance',
    'accept-alliance',
    'leave-alliance',
    'invalid',
  ]),
  recipientId: agentIdSchema.nullable().optional(),
  proposalId: allianceProposalIdSchema.nullable().optional(),
});
export const diplomacyResultSchema = z.union([
  z.object({ requested: z.literal(false) }).strict(),
  z.object({
    requested: z.literal(true),
    accepted: z.literal(true),
    intent: diplomacyIntentSchema,
    events: z.array(allianceEventSchema).min(1),
  }),
  z.object({
    requested: z.literal(true),
    accepted: z.literal(false),
    attempt: diplomacyAttemptSchema,
    reason: diplomacyRejectionReasonSchema,
    details: z.string().min(1).max(300),
  }),
]);
export type DiplomacyResult = z.infer<typeof diplomacyResultSchema>;

const worldSnapshotObjectSchema = z.object({
  generatedAt: z.iso.datetime(),
  hexes: z.array(hexSchema),
  agents: z.array(agentSchema),
  events: z.array(worldEventSchema).max(120),
  alliances: z.array(allianceSchema).max(4).default([]),
  pendingAllianceProposals: z
    .array(allianceProposalSchema)
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount)
    .default([]),
});

function validateWorldControllers(
  world: Pick<
    z.infer<typeof worldSnapshotObjectSchema>,
    'hexes' | 'agents' | 'alliances' | 'pendingAllianceProposals'
  >,
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
  const memberships = new Set<AgentId>();
  const colors = new Set<string>();
  const allianceIds = new Set<AllianceId>();
  for (const [index, alliance] of world.alliances.entries()) {
    if (allianceIds.has(alliance.id))
      context.addIssue({
        code: 'custom',
        path: ['alliances', index, 'id'],
        message: 'Active alliance IDs must be unique.',
      });
    allianceIds.add(alliance.id);
    if (colors.has(alliance.color))
      context.addIssue({
        code: 'custom',
        path: ['alliances', index, 'color'],
        message: 'Active alliance colors must be unique.',
      });
    colors.add(alliance.color);
    for (const memberId of alliance.memberAgentIds) {
      if (!agentIds.has(memberId))
        context.addIssue({
          code: 'custom',
          path: ['alliances', index, 'memberAgentIds'],
          message: 'Alliance members must be world agents.',
        });
      if (memberships.has(memberId))
        context.addIssue({
          code: 'custom',
          path: ['alliances', index, 'memberAgentIds'],
          message: 'An agent may belong to at most one alliance.',
        });
      memberships.add(memberId);
    }
  }
  const outgoing = new Set<AgentId>();
  const incoming = new Set<AgentId>();
  const proposalIds = new Set<AllianceProposalId>();
  for (const [index, proposal] of world.pendingAllianceProposals.entries()) {
    if (proposalIds.has(proposal.id))
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'id'],
        message: 'Proposal IDs must be unique.',
      });
    proposalIds.add(proposal.id);
    if (
      !agentIds.has(proposal.proposerAgentId) ||
      !agentIds.has(proposal.recipientAgentId)
    )
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index],
        message: 'Proposal participants must be world agents.',
      });
    if (outgoing.has(proposal.proposerAgentId))
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'proposerAgentId'],
        message: 'A proposer may have at most one outgoing proposal.',
      });
    if (incoming.has(proposal.recipientAgentId))
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'recipientAgentId'],
        message: 'A recipient may have at most one incoming proposal.',
      });
    if (
      proposal.expirationTurn !==
      proposal.originatingTurn + ALLIANCE_PROPOSAL_DURATION_TURNS
    )
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'expirationTurn'],
        message: 'Proposal expiration must be exactly one eight-agent round.',
      });
    if (
      proposal.proposerAllianceId &&
      !world.alliances.some(({ id }) => id === proposal.proposerAllianceId)
    )
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'proposerAllianceId'],
        message: 'A recorded proposer alliance must be active.',
      });
    if (
      proposal.proposerAllianceId &&
      !world.alliances
        .find(({ id }) => id === proposal.proposerAllianceId)
        ?.memberAgentIds.includes(proposal.proposerAgentId)
    )
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'proposerAllianceId'],
        message: 'The proposer must remain in the recorded alliance.',
      });
    if (memberships.has(proposal.recipientAgentId))
      context.addIssue({
        code: 'custom',
        path: ['pendingAllianceProposals', index, 'recipientAgentId'],
        message: 'A proposal recipient must remain unaffiliated.',
      });
    outgoing.add(proposal.proposerAgentId);
    incoming.add(proposal.recipientAgentId);
  }
}

export const worldSnapshotSchema = worldSnapshotObjectSchema.superRefine(
  validateWorldControllers,
);
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

export const cellObservationSchema = z.discriminatedUnion('state', [
  z.object({
    cell: h3CellSchema,
    state: z.literal('open'),
    controllerAgentId: z.null(),
    controllerAllianceId: z.null(),
    effectiveColor: z.null(),
  }),
  z.object({
    cell: h3CellSchema,
    state: z.literal('infected'),
    controllerAgentId: agentIdSchema,
    controllerAllianceId: allianceIdSchema.nullable(),
    effectiveColor: colorSchema,
  }),
]);
export type CellObservation = z.infer<typeof cellObservationSchema>;

export const nearbyAgentObservationSchema = z.object({
  id: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  currentCell: h3CellSchema,
  distance: z.number().int().min(0).max(4),
  allianceId: allianceIdSchema.nullable(),
});

export const publicEventObservationSchema = z.object({
  type: z.enum(['agent-moved', 'hex-infected', 'hex-captured', 'agent-waited']),
  agentId: agentIdSchema,
  occurredAt: z.iso.datetime(),
  summary: z.string().trim().min(1).max(180),
});

export const observedPublicMessageSchema = z.object({
  eventId: eventIdSchema,
  senderId: agentIdSchema,
  senderName: z.string().trim().min(1).max(80),
  message: messageContentSchema,
  occurredAt: z.iso.datetime(),
});
export type ObservedPublicMessage = z.infer<typeof observedPublicMessageSchema>;

export const observedDirectMessageSchema = z.object({
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
export type ObservedDirectMessage = z.infer<typeof observedDirectMessageSchema>;

export const territoryScoreboardEntrySchema = z.object({
  agentId: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
  allianceId: allianceIdSchema.nullable(),
  effectiveColor: colorSchema,
  controlledCellCount: z
    .number()
    .int()
    .nonnegative()
    .max(DEVELOPMENT_WORLD_CONFIG.cellCount),
});
export const territoryScoreboardSchema = z
  .array(territoryScoreboardEntrySchema)
  .length(DEVELOPMENT_WORLD_CONFIG.agentCount)
  .refine(
    (entries) =>
      new Set(entries.map(({ agentId }) => agentId)).size ===
      DEVELOPMENT_WORLD_CONFIG.agentCount,
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

export const allianceTerritorySummarySchema = z
  .object({
    allianceId: allianceIdSchema,
    color: z.enum(ALLIANCE_COLOR_PALETTE),
    totalControlledCellCount: z
      .number()
      .int()
      .nonnegative()
      .max(DEVELOPMENT_WORLD_CONFIG.cellCount),
    members: z
      .array(
        z.object({
          agentId: agentIdSchema,
          name: z.string().trim().min(1).max(80),
          controlledCellCount: z
            .number()
            .int()
            .nonnegative()
            .max(DEVELOPMENT_WORLD_CONFIG.cellCount),
        }),
      )
      .min(2)
      .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
  })
  .refine(
    ({ totalControlledCellCount, members }) =>
      totalControlledCellCount ===
      members.reduce((sum, member) => sum + member.controlledCellCount, 0),
    { message: 'Alliance territory must equal the sum of member control.' },
  );
export type AllianceTerritorySummary = z.infer<
  typeof allianceTerritorySummarySchema
>;

export const observedAllianceEventSchema = z.object({
  event: allianceEventSchema,
  summary: z.string().trim().min(1).max(240),
});

const agentObservationObjectSchema = z.object({
  agentId: agentIdSchema,
  agentName: z.string().trim().min(1).max(80),
  personality: z.string().trim().min(1).max(PERSONALITY_MAX_LENGTH),
  currentCell: cellObservationSchema,
  captureEligibility: captureEligibilitySchema,
  actionAvailability: z
    .object({
      moveTargetCellIds: z.array(h3CellSchema).min(1).max(6),
      infect: z.discriminatedUnion('available', [
        z.object({ available: z.literal(true) }).strict(),
        z
          .object({
            available: z.literal(false),
            reason: z.literal('current-cell-already-infected'),
          })
          .strict(),
      ]),
      capture: z.discriminatedUnion('available', [
        z.object({ available: z.literal(true) }).strict(),
        z
          .object({
            available: z.literal(false),
            reason: captureBlockedReasonSchema,
          })
          .strict(),
      ]),
      wait: z.object({ available: z.literal(true) }).strict(),
    })
    .strict()
    .optional(),
  adjacentCells: z.array(cellObservationSchema).min(1).max(6),
  nearbyAgents: z
    .array(nearbyAgentObservationSchema)
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount - 1),
  recentEvents: z.array(publicEventObservationSchema).max(8),
  recentPublicMessages: z
    .array(observedPublicMessageSchema)
    .max(RECENT_PUBLIC_MESSAGE_LIMIT),
  recentDirectMessages: z
    .array(observedDirectMessageSchema)
    .max(RECENT_DIRECT_MESSAGE_LIMIT),
  territoryScoreboard: territoryScoreboardSchema,
  actingAllianceId: allianceIdSchema.nullable(),
  actingAlliance: allianceTerritorySummarySchema.nullable(),
  activeAlliances: z.array(allianceTerritorySummarySchema).max(4),
  inboundAllianceProposals: z.array(allianceProposalSchema).max(1),
  outboundAllianceProposals: z.array(allianceProposalSchema).max(1),
  recentAllianceEvents: z
    .array(observedAllianceEventSchema)
    .max(RECENT_ALLIANCE_EVENT_LIMIT),
  recentControlChanges: z
    .array(observedControlChangeSchema)
    .max(RECENT_CONTROL_CHANGE_LIMIT),
});

export const agentObservationSchema = agentObservationObjectSchema.transform(
  (observation) => ({
    ...observation,
    actionAvailability: observation.actionAvailability ?? {
      moveTargetCellIds: observation.adjacentCells.map(({ cell }) => cell),
      infect:
        observation.currentCell.state === 'open'
          ? { available: true as const }
          : {
              available: false as const,
              reason: 'current-cell-already-infected' as const,
            },
      capture: observation.captureEligibility.eligible
        ? { available: true as const }
        : {
            available: false as const,
            reason: observation.captureEligibility.blockedReason,
          },
      wait: { available: true as const },
    },
  }),
);
export type AgentObservation = z.infer<typeof agentObservationSchema>;

export const agentDecisionSchema = z
  .object({
    worldAction: worldActionSchema,
    communication: communicationIntentSchema.nullish(),
    diplomacy: diplomacyIntentSchema.nullish(),
    summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH),
  })
  .strict();
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const providerDecisionEnvelopeSchema = z
  .object({
    worldAction: worldActionSchema,
    communication: z.unknown().optional(),
    diplomacy: z.unknown().optional(),
    summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH),
  })
  .strict();
export type ProviderDecisionEnvelope = z.infer<
  typeof providerDecisionEnvelopeSchema
>;

export const providerModeSchema = z.enum(['openrouter', 'scripted-test']);
export type ProviderMode = z.infer<typeof providerModeSchema>;

export const modelIdSchema = z.string().trim().min(1).max(200);
export type ModelId = z.infer<typeof modelIdSchema>;

const priceStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/)
  .max(80);

export const reasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const reasoningProfileSchema = z.enum([
  'provider-default',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export type ReasoningProfile = z.infer<typeof reasoningProfileSchema>;

export const compatibleModelReasoningSchema = z.object({
  supportedEfforts: z.array(reasoningEffortSchema).nullable().optional(),
  defaultEffort: reasoningEffortSchema.optional(),
  defaultEnabled: z.boolean().optional(),
  supportsMaxTokens: z.boolean().optional(),
  mandatory: z.boolean(),
});

export const compatibleModelSchema = z.object({
  id: modelIdSchema,
  name: z.string().trim().min(1).max(160),
  author: z.string().trim().min(1).max(100),
  contextLength: z.number().int().min(OPENROUTER_MODEL_CONTEXT_MINIMUM),
  inputPricePerToken: priceStringSchema,
  outputPricePerToken: priceStringSchema,
  requestPrice: priceStringSchema.optional(),
  supportedParameters: z.array(z.string().trim().min(1).max(80)).max(80),
  createdAt: z.iso.datetime().optional(),
  expirationDate: z.iso.date().nullable().optional(),
  isFree: z.boolean(),
  reasoning: compatibleModelReasoningSchema.optional(),
});
export type CompatibleModel = z.infer<typeof compatibleModelSchema>;

const reasoningProfileOrder: Exclude<
  ReasoningProfile,
  'provider-default' | 'off'
>[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function reasoningProfilesForModel(
  model: CompatibleModel | undefined,
): ReasoningProfile[] {
  if (!model?.reasoning) return ['provider-default'];
  const advertised = new Set(model.reasoning.supportedEfforts ?? []);
  return [
    'provider-default',
    ...(model.reasoning.mandatory ? [] : (['off'] as const)),
    ...reasoningProfileOrder.filter((profile) => advertised.has(profile)),
  ];
}

export function modelSupportsReasoningProfile(
  model: CompatibleModel | undefined,
  profile: ReasoningProfile,
): boolean {
  return reasoningProfilesForModel(model).includes(profile);
}

export const modelOverrideSchema = z.object({
  agentId: agentIdSchema,
  modelId: modelIdSchema,
  reasoningProfile: reasoningProfileSchema.default('provider-default'),
});
export const experimentModelConfigurationSchema = z
  .object({
    globalModelId: modelIdSchema.nullable(),
    globalReasoningProfile: reasoningProfileSchema.default('provider-default'),
    overrides: z
      .array(modelOverrideSchema)
      .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
    /** Retained for version-6 import compatibility; runtime selection is never turn-locked. */
    locked: z.boolean().default(false),
  })
  .strict()
  .refine(
    ({ overrides }) =>
      new Set(overrides.map(({ agentId }) => agentId)).size ===
      overrides.length,
    { message: 'Each agent may have at most one model override.' },
  );
export type ExperimentModelConfiguration = z.infer<
  typeof experimentModelConfigurationSchema
>;

export const resolvedAgentModelSchema = z.object({
  agentId: agentIdSchema,
  modelId: modelIdSchema.nullable(),
  reasoningProfile: reasoningProfileSchema.default('provider-default'),
  source: z.enum(['global', 'override', 'missing']),
  available: z.boolean(),
  issue: z.enum(['missing', 'unavailable', 'reasoning-unavailable']).optional(),
});
export type ResolvedAgentModel = z.infer<typeof resolvedAgentModelSchema>;

export const modelCatalogErrorSchema = z.object({
  code: z.enum([
    'configuration',
    'timeout',
    'network',
    'provider-http',
    'invalid-response',
  ]),
  message: z.string().trim().min(1).max(240),
});
export const modelCatalogResponseSchema = z.object({
  models: z.array(compatibleModelSchema),
  filteredOutCount: z.number().int().nonnegative(),
  fetchedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  stale: z.boolean(),
  error: modelCatalogErrorSchema.optional(),
  requirements: z.object({
    input: z.literal('text'),
    output: z.literal('text'),
    endpoint: z.literal('chat-completions'),
    requiredParameters: z
      .array(z.enum(OPENROUTER_REQUIRED_PARAMETERS))
      .length(OPENROUTER_REQUIRED_PARAMETERS.length),
    minimumContextLength: z.literal(OPENROUTER_MODEL_CONTEXT_MINIMUM),
    streaming: z.literal(false),
  }),
});
export type ModelCatalogResponse = z.infer<typeof modelCatalogResponseSchema>;

export const updateExperimentModelsRequestSchema = z
  .object({
    globalModelId: modelIdSchema.nullable(),
    globalReasoningProfile: reasoningProfileSchema.default('provider-default'),
    overrides: z
      .array(modelOverrideSchema)
      .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
  })
  .strict();
export const updateExperimentModelsResponseSchema = z.object({
  snapshot: z.lazy(() => simulationSnapshotSchema),
});

export const modelVerificationStatusSchema = z.enum([
  'untested',
  'verified',
  'failed',
]);
export const modelVerificationSchema = z.object({
  modelId: modelIdSchema,
  reasoningProfile: reasoningProfileSchema.default('provider-default'),
  contractVersion: z.literal(AGENT_DECISION_CONTRACT_VERSION),
  status: modelVerificationStatusSchema,
  testedAt: z.iso.datetime().optional(),
  failure: z
    .object({
      code: z.string().trim().min(1).max(80),
      message: z.string().trim().min(1).max(PROVIDER_ERROR_MAX_LENGTH),
    })
    .optional(),
  provider: z.lazy(() => providerMetadataSchema).optional(),
});
export type ModelVerification = z.infer<typeof modelVerificationSchema>;

export const verifyModelRequestSchema = z
  .object({
    modelId: modelIdSchema,
    reasoningProfile: reasoningProfileSchema.default('provider-default'),
    force: z.boolean().optional(),
  })
  .strict();
export const verifyModelResponseSchema = z.object({
  verification: modelVerificationSchema,
});

export const providerMetadataSchema = z.object({
  provider: providerModeSchema,
  model: modelIdSchema,
  selectedModel: modelIdSchema.optional(),
  resolvedModel: modelIdSchema.optional(),
  requestId: z.string().trim().min(1).max(160).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  finishReason: z.string().trim().min(1).max(80).optional(),
  nativeFinishReason: z.string().trim().min(1).max(120).optional(),
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
    'model-unavailable',
    'provider-http',
    'cancelled',
    'malformed-response',
    'unsupported-response',
    'output-length',
    'missing-text-output',
    'invalid-json',
    // Retained so schema-v6 exports produced by the superseded tool contract
    // remain importable. The text contract never emits these codes.
    'missing-tool-call',
    'multiple-tool-calls',
    'wrong-tool',
    'invalid-tool-arguments',
    'invalid-decision',
    'simulation-validation',
  ]),
  message: z.string().trim().min(1).max(PROVIDER_ERROR_MAX_LENGTH),
  retryable: z.boolean(),
  latencyMs: z.number().int().nonnegative().max(300_000).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  providerCode: z.string().trim().min(1).max(80).optional(),
  providerMessage: z
    .string()
    .trim()
    .min(1)
    .max(PROVIDER_ERROR_MAX_LENGTH)
    .optional(),
  requestId: z.string().trim().min(1).max(160).optional(),
  model: modelIdSchema.optional(),
  finishReason: z.string().trim().min(1).max(80).optional(),
  nativeFinishReason: z.string().trim().min(1).max(120).optional(),
  validationCodes: z
    .array(
      z.enum([
        'missing-json-object',
        'multiple-json-objects',
        'invalid-json',
        'missing-required-field',
        'invalid-field-type',
        'invalid-enum-value',
        'contradictory-fields',
        'invalid-recipient-sentinel',
        'invalid-action-fields',
      ]),
    )
    .max(8)
    .optional(),
  retryAfterMs: z.number().int().nonnegative().max(75_000).optional(),
});
export type ProviderFailure = z.infer<typeof providerFailureSchema>;

export const modelAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  kind: z.enum([
    'initial',
    'automatic-repair',
    'automatic-transport-retry',
    'manual-retry',
  ]),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  modelId: modelIdSchema,
  reasoningProfile: reasoningProfileSchema.default('provider-default'),
  failure: providerFailureSchema.optional(),
  provider: providerMetadataSchema.optional(),
});
export type ModelAttempt = z.infer<typeof modelAttemptSchema>;

const turnRecordBaseSchema = z.object({
  turnNumber: z.number().int().positive(),
  agentId: agentIdSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  observation: agentObservationSchema,
  allianceEvents: z.array(allianceEventSchema).default([]),
  modelAttempts: z.array(modelAttemptSchema).max(1_000).default([]),
});

const completedTurnFields = {
  worldAction: worldActionSchema,
  communication: communicationIntentSchema.optional(),
  diplomacy: diplomacyIntentSchema.optional(),
  summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH),
  provider: providerMetadataSchema,
  communicationResult: communicationResultSchema,
  diplomacyResult: diplomacyResultSchema,
};

export const agentTurnRecordSchema = z
  .discriminatedUnion('outcome', [
    turnRecordBaseSchema.extend({
      outcome: z.literal('accepted'),
      ...completedTurnFields,
      worldActionResult: z.object({
        accepted: z.literal(true),
        event: nonCommunicationWorldEventSchema,
      }),
    }),
    turnRecordBaseSchema.extend({
      outcome: z.literal('rejected'),
      ...completedTurnFields,
      worldActionResult: z.object({
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
    turnRecordBaseSchema.extend({
      outcome: z.literal('operator-skipped'),
      failure: providerFailureSchema,
      provider: providerMetadataSchema.optional(),
    }),
  ])
  .superRefine((turn, context) => {
    if (
      turn.outcome === 'operator-skipped' &&
      turn.failure.model !== undefined &&
      turn.provider?.model !== turn.failure.model
    )
      context.addIssue({
        code: 'custom',
        message: 'Skipped-turn failure and provider models must match.',
      });
  });
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
    cancellationRequested: z.boolean().default(false),
    pendingFailedTurn: z
      .object({
        turnNumber: z.number().int().positive(),
        agentId: agentIdSchema,
        failure: providerFailureSchema,
        attempts: z.array(modelAttemptSchema).min(1).max(1_000),
      })
      .nullable()
      .default(null),
    status: simulationStatusSchema,
    providerMode: providerModeSchema,
    providerConfigured: z.boolean(),
    modelConfiguration: experimentModelConfigurationSchema,
    resolvedModels: z
      .array(resolvedAgentModelSchema)
      .length(DEVELOPMENT_WORLD_CONFIG.agentCount),
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
      currentAlliances: z.array(allianceTerritorySummarySchema).max(4),
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
      const alliance = snapshot.world.alliances.find(({ memberAgentIds }) =>
        memberAgentIds.includes(entry.agentId),
      );
      if (
        entry.allianceId !== (alliance?.id ?? null) ||
        entry.effectiveColor !== (alliance?.color ?? agent?.color)
      )
        context.addIssue({
          code: 'custom',
          path: ['experiment', 'currentTerritory', index],
          message:
            'Current territory alliance and effective color must be authoritative.',
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
    for (const [
      index,
      summary,
    ] of snapshot.experiment.currentAlliances.entries()) {
      const alliance = snapshot.world.alliances.find(
        ({ id }) => id === summary.allianceId,
      );
      if (
        !alliance ||
        alliance.color !== summary.color ||
        alliance.memberAgentIds.length !== summary.members.length ||
        alliance.memberAgentIds.some(
          (id) => !summary.members.some(({ agentId }) => agentId === id),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['experiment', 'currentAlliances', index],
          message:
            'Current alliance summary must match authoritative membership.',
        });
      for (const member of summary.members) {
        const territory = snapshot.experiment.currentTerritory.find(
          ({ agentId }) => agentId === member.agentId,
        );
        if (
          !territory ||
          territory.controlledCellCount !== member.controlledCellCount
        )
          context.addIssue({
            code: 'custom',
            path: ['experiment', 'currentAlliances', index, 'members'],
            message:
              'Alliance member territory must match current individual control.',
          });
      }
    }
    if (
      snapshot.experiment.currentAlliances.length !==
      snapshot.world.alliances.length
    )
      context.addIssue({
        code: 'custom',
        path: ['experiment', 'currentAlliances'],
        message: 'Every active alliance requires one current summary.',
      });
  });
export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;

export const singleTurnResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
  turn: agentTurnRecordSchema,
});
export type SingleTurnResponse = z.infer<typeof singleTurnResponseSchema>;

export const cancelledTurnResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
  cancelled: z.literal(true),
});
export type CancelledTurnResponse = z.infer<typeof cancelledTurnResponseSchema>;

export const resetSimulationResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
});
export type ResetSimulationResponse = z.infer<
  typeof resetSimulationResponseSchema
>;
export const cancelSimulationResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
});

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
  'model_configuration_conflict',
  'invalid_model_configuration',
  'models_unavailable',
  'model_verification_conflict',
  'cancel_conflict',
  'invalid_import',
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

export const modelConfigurationEventSchema = z
  .object({
    type: z.literal('model-assignment-changed'),
    timestamp: z.iso.datetime(),
    scope: z.enum(['global', 'agent']),
    agentId: agentIdSchema.optional(),
    previousModelId: modelIdSchema.nullable(),
    newModelId: modelIdSchema.nullable(),
    previousReasoningProfile:
      reasoningProfileSchema.default('provider-default'),
    newReasoningProfile: reasoningProfileSchema.default('provider-default'),
    effectiveTurn: z.number().int().positive(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.scope === 'agent' && event.agentId === undefined)
      context.addIssue({
        code: 'custom',
        path: ['agentId'],
        message: 'Agent-scoped model changes require an agent ID.',
      });
    if (event.scope === 'global' && event.agentId !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['agentId'],
        message: 'Global model changes must not include an agent ID.',
      });
  });
export type ModelConfigurationEvent = z.infer<
  typeof modelConfigurationEventSchema
>;
export const experimentConfigurationEventSchema = z.union([
  personalityConfigurationEventSchema,
  modelConfigurationEventSchema,
]);
export type ExperimentConfigurationEvent = z.infer<
  typeof experimentConfigurationEventSchema
>;

export const experimentManifestSchema = z.object({
  id: experimentIdSchema,
  startedAt: z.iso.datetime(),
  generatedAt: z.iso.datetime().optional(),
  providerMode: providerModeSchema,
  modelConfiguration: experimentModelConfigurationSchema.optional(),
  initialAgents: z
    .array(agentProfileSchema)
    .length(DEVELOPMENT_WORLD_CONFIG.agentCount)
    .optional(),
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

export const metricCountsSchema = z
  .object({
    totalTurns: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    providerErrors: z.number().int().nonnegative(),
    operatorSkipped: z.number().int().nonnegative().default(0),
    modelCalls: z.number().int().nonnegative().default(0),
    failedModelAttempts: z.number().int().nonnegative().default(0),
    automaticRepairAttempts: z.number().int().nonnegative().default(0),
    automaticTransportRetries: z.number().int().nonnegative().default(0),
    manualRetryAttempts: z.number().int().nonnegative().default(0),
    retriedTurns: z.number().int().nonnegative().default(0),
    recoveredAutomatically: z.number().int().nonnegative().default(0),
    recoveredManually: z.number().int().nonnegative().default(0),
    recoveredByRetry: z.number().int().nonnegative().default(0),
    requestedMoves: z.number().int().nonnegative(),
    requestedInfections: z.number().int().nonnegative(),
    requestedCaptures: z.number().int().nonnegative(),
    requestedWaits: z.number().int().nonnegative(),
    acceptedMovements: z.number().int().nonnegative(),
    successfullyInfectedCells: z.number().int().nonnegative(),
    successfulCaptures: z.number().int().nonnegative(),
    acceptedWaits: z.number().int().nonnegative().default(0),
    rejectedWorldActions: z.number().int().nonnegative().default(0),
    territoryGainedThroughInfection: z.number().int().nonnegative(),
    territoryGainedThroughCapture: z.number().int().nonnegative(),
    territoryLostThroughCapture: z.number().int().nonnegative(),
    publicMessagesRequested: z.number().int().nonnegative().default(0),
    publicMessagesAccepted: z.number().int().nonnegative().default(0),
    publicMessagesRejected: z.number().int().nonnegative().default(0),
    directMessagesRequested: z.number().int().nonnegative().default(0),
    directMessagesDelivered: z.number().int().nonnegative().default(0),
    directMessagesRejected: z.number().int().nonnegative().default(0),
    publicMessagesSent: z.number().int().nonnegative().default(0),
    directMessagesSent: z.number().int().nonnegative().default(0),
    directMessagesReceived: z.number().int().nonnegative().default(0),
    diplomacyProposalsRequested: z.number().int().nonnegative().default(0),
    diplomacyAcceptancesRequested: z.number().int().nonnegative().default(0),
    diplomacyDeparturesRequested: z.number().int().nonnegative().default(0),
    diplomacyProposalsAccepted: z.number().int().nonnegative().default(0),
    diplomacyAcceptancesAccepted: z.number().int().nonnegative().default(0),
    diplomacyDeparturesAccepted: z.number().int().nonnegative().default(0),
    diplomacyRejected: z.number().int().nonnegative().default(0),
    diplomacyRejections: z
      .array(
        z.object({
          type: z.enum([
            'propose-alliance',
            'accept-alliance',
            'leave-alliance',
            'invalid',
          ]),
          reason: diplomacyRejectionReasonSchema,
          count: z.number().int().positive(),
        }),
      )
      .max(48)
      .default([]),
    proposalsCreated: z.number().int().nonnegative().default(0),
    proposalsSent: z.number().int().nonnegative().default(0),
    proposalsReceived: z.number().int().nonnegative().default(0),
    proposalsExpired: z.number().int().nonnegative().default(0),
    proposalsInvalidated: z.number().int().nonnegative().default(0),
    alliancesFormed: z.number().int().nonnegative().default(0),
    alliancesJoined: z.number().int().nonnegative().default(0),
    alliancesLeft: z.number().int().nonnegative().default(0),
    alliancesDissolved: z.number().int().nonnegative().default(0),
    alliedCaptureAttempts: z.number().int().nonnegative().default(0),
    alliedCaptureRejections: z.number().int().nonnegative().default(0),
    uniqueVisitedCells: z.number().int().nonnegative(),
    averageLatencyMs: z.number().nonnegative().optional(),
    tokens: tokenTotalsSchema,
    tokenUsageComplete: z.boolean().default(true),
    attemptsWithUnknownTokenUsage: z.number().int().nonnegative().default(0),
    knownCostCredits: z.number().nonnegative().finite(),
    attemptsWithUnknownCost: z.number().int().nonnegative().default(0),
    turnsWithUnknownCost: z.number().int().nonnegative(),
  })
  .superRefine((metrics, context) => {
    if (
      metrics.totalTurns !==
      metrics.accepted +
        metrics.rejected +
        metrics.providerErrors +
        metrics.operatorSkipped
    )
      context.addIssue({
        code: 'custom',
        message: 'Logical turn outcome totals do not reconcile.',
      });
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
  'operator-skipped',
]);
export const exportActionSchema = z.enum(['move', 'infect', 'capture', 'wait']);
export const exportCommunicationChannelSchema = z.enum([
  'all',
  'public',
  'direct',
]);
export const exportCommunicationStatusSchema = z.enum([
  'all',
  'accepted',
  'rejected',
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
    recentPublicMessages: z.boolean(),
    recentDirectMessages: z.boolean(),
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
        value.recentPublicMessages ||
        value.recentDirectMessages ||
        value.recentControlChanges)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Nearby agents, recent events, recent messages, and recent control changes require turn observations.',
      });
    }
  });
export type CustomExportOptions = z.infer<typeof customExportOptionsSchema>;

const exportSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      mode: z.literal('selected'),
      agentIds: z
        .array(agentIdSchema)
        .min(1)
        .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
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
    outcomes: z.array(exportOutcomeSchema).min(1).max(4),
    actions: z.array(exportActionSchema).min(1).max(4),
    communications: z
      .object({
        channel: exportCommunicationChannelSchema,
        status: exportCommunicationStatusSchema,
      })
      .strict()
      .default({ channel: 'all', status: 'all' }),
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
  matchingTurnCount: z.number().int().nonnegative(),
  matchingCommunicationCount: z.number().int().nonnegative(),
  matchingControlChangeCount: z.number().int().nonnegative(),
  matchingDiplomacyEventCount: z.number().int().nonnegative(),
  selectedAgentCount: z
    .number()
    .int()
    .positive()
    .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
  firstMatchingTurn: z.number().int().positive().optional(),
  lastMatchingTurn: z.number().int().positive().optional(),
  retention: experimentRetentionSchema,
  knownCostCredits: z.number().nonnegative().finite(),
  attemptsWithUnknownCost: z.number().int().nonnegative().default(0),
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
  worldAction: worldActionSchema.optional(),
  communication: communicationIntentSchema.optional(),
  diplomacy: diplomacyIntentSchema.optional(),
  summary: z.string().trim().min(1).max(MODEL_SUMMARY_MAX_LENGTH).optional(),
  worldActionSummary: z.string().trim().min(1).max(300).optional(),
  communicationSummary: z.string().trim().min(1).max(300).optional(),
  diplomacySummary: z.string().trim().min(1).max(300).optional(),
  personality: personalitySchema.optional(),
  observation: agentObservationObjectSchema.partial().optional(),
  worldActionResult: worldActionResultSchema.optional(),
  communicationResult: communicationResultSchema.optional(),
  diplomacyResult: diplomacyResultSchema.optional(),
  failure: providerFailureSchema.optional(),
  provider: providerMetadataSchema.optional(),
  modelAttempts: z.array(modelAttemptSchema).max(1_000).default([]),
});

export const experimentExportWorldStateSchema = worldSnapshotObjectSchema
  .omit({ events: true })
  .superRefine(validateWorldControllers);

export const exportedCommunicationSchema = z
  .object({
    id: eventIdSchema,
    agentId: agentIdSchema,
    channel: z.enum(['public', 'direct']),
    recipientId: agentIdSchema.nullable().optional(),
    message: messageContentSchema,
    distance: z.number().int().nonnegative().nullable().optional(),
    occurredAt: z.iso.datetime(),
    originatingTurn: z.number().int().positive(),
    status: z.enum(['accepted', 'rejected']),
    rejectionReason: communicationRejectionReasonSchema.optional(),
    rejectionDetails: z.string().min(1).max(300).optional(),
  })
  .superRefine((communication, context) => {
    if (
      communication.channel === 'direct' &&
      (communication.recipientId === undefined ||
        communication.distance === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Direct communication requires a recipient and distance.',
      });
    if (
      communication.channel === 'direct' &&
      communication.status === 'accepted' &&
      (communication.recipientId === null || communication.distance === null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Accepted direct communication requires a valid recipient.',
      });
    if (
      communication.channel === 'public' &&
      (communication.recipientId !== undefined ||
        communication.distance !== undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Public communication cannot have a recipient or distance.',
      });
    if (
      communication.status === 'rejected' &&
      (!communication.rejectionReason || !communication.rejectionDetails)
    )
      context.addIssue({
        code: 'custom',
        message: 'Rejected communication requires a safe rejection reason.',
      });
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
    schemaVersion: z.literal(7),
    generatedAt: z.iso.datetime(),
    experiment: experimentManifestSchema,
    retention: experimentRetentionSchema,
    filters: experimentExportRequestSchema,
    selection: z.object({
      selectedAgentIds: z
        .array(agentIdSchema)
        .min(1)
        .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
      matchingTurnCount: z.number().int().nonnegative(),
      matchingCommunicationCount: z.number().int().nonnegative(),
      matchingControlChangeCount: z.number().int().nonnegative(),
      matchingDiplomacyEventCount: z.number().int().nonnegative(),
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
      .max(DEVELOPMENT_WORLD_CONFIG.agentCount),
    configurationEvents: z.array(experimentConfigurationEventSchema).optional(),
    metrics: experimentMetricsSchema.optional(),
    currentTerritory: territoryScoreboardSchema.optional(),
    currentAlliances: z.array(allianceTerritorySummarySchema).max(4).optional(),
    initialWorld: experimentExportWorldStateSchema.optional(),
    currentWorld: experimentExportWorldStateSchema.optional(),
    worldEvents: z.array(nonCommunicationWorldEventSchema).optional(),
    communications: z.array(exportedCommunicationSchema).optional(),
    controlChanges: z.array(exportedControlChangeSchema).optional(),
    allianceEvents: z.array(allianceEventSchema).optional(),
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
    if (Boolean(document.currentAlliances) !== Boolean(requiresMetrics))
      context.addIssue({
        code: 'custom',
        message: 'Current alliance inclusion does not match the export level.',
      });
    const personalityHistory =
      level === 'full-safe' || custom?.personalityTextHistory;
    if (personalityHistory && document.configurationEvents === undefined)
      context.addIssue({
        code: 'custom',
        message:
          'Personality history inclusion does not match the export level.',
      });
    if (
      !personalityHistory &&
      document.configurationEvents?.some((event) => !('type' in event))
    )
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
      const results = Boolean(validation || event);
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
        turn.outcome !== 'operator-skipped' &&
        (Boolean(turn.worldActionResult) !== results ||
          Boolean(turn.communicationResult) !== results ||
          Boolean(turn.diplomacyResult) !== results)
      )
        context.addIssue({
          code: 'custom',
          message: 'Validation inclusion does not match the export level.',
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
export const experimentImportRequestSchema = z
  .object({ document: z.unknown() })
  .strict();
export const experimentImportResponseSchema = z.object({
  snapshot: simulationSnapshotSchema,
  legacy: z.boolean(),
  message: z.string().trim().min(1).max(300),
});
