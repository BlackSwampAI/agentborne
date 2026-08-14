import { z } from 'zod';

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

export const agentSchema = z.object({
  id: agentIdSchema,
  name: z.string().trim().min(1).max(80),
  currentCell: h3CellSchema,
});
export type Agent = z.infer<typeof agentSchema>;

export const moveActionSchema = z.object({
  type: z.literal('move'),
  targetCell: h3CellSchema,
});

export const infectActionSchema = z.object({
  type: z.literal('infect'),
});

export const messageActionSchema = z.object({
  type: z.literal('message'),
  recipientId: agentIdSchema,
  message: z.string().trim().min(1).max(1_000),
});

export const waitActionSchema = z.object({
  type: z.literal('wait'),
});

export const requestedActionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  infectActionSchema,
  messageActionSchema,
  waitActionSchema,
]);
export type RequestedAction = z.infer<typeof requestedActionSchema>;

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
  z.object({
    accepted: z.literal(true),
    event: worldEventSchema,
  }),
  z.object({
    accepted: z.literal(false),
    reason: invalidActionReasonSchema,
    details: z.string().min(1),
  }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;

export const worldSnapshotSchema = z.object({
  generatedAt: z.iso.datetime(),
  hexes: z.array(z.object({ cell: h3CellSchema, state: hexStateSchema })),
  agents: z.array(agentSchema),
  events: z.array(worldEventSchema),
});
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
