import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import {
  agentIdSchema,
  communicationIntentSchema,
  h3CellSchema,
  MESSAGE_MAX_LENGTH,
  MESSAGE_RANGE,
  worldActionSchema,
  type ActionResult,
  type Agent,
  type AgentId,
  type CaptureEligibility,
  type CommunicationResult,
  type H3Cell,
  type NonCommunicationWorldEvent,
  type WorldEvent,
  type WorldActionResult,
  type WorldSnapshot,
} from '@agentborne/shared';

export interface WorldState {
  readonly hexes: ReadonlyMap<H3Cell, HexControl>;
  readonly agents: ReadonlyMap<AgentId, Agent>;
  readonly events: readonly WorldEvent[];
}

export type HexControl =
  | { readonly state: 'open'; readonly controllerAgentId: null }
  | { readonly state: 'infected'; readonly controllerAgentId: AgentId };

export interface EngineContext {
  createEventId: () => string;
  now: () => string;
}

export interface AppliedAction {
  state: WorldState;
  result: WorldActionResult;
}

export interface AppliedCommunication {
  state: WorldState;
  result: CommunicationResult;
}

const defaultContext: EngineContext = {
  createEventId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

function rejected(
  state: WorldState,
  reason: Extract<ActionResult, { accepted: false }>['reason'],
  details: string,
): AppliedAction {
  return { state, result: { accepted: false, reason, details } };
}

export function areAdjacent(from: H3Cell, to: H3Cell): boolean {
  try {
    return gridDistance(from, to) === 1;
  } catch {
    return false;
  }
}

export function getCaptureEligibility(
  state: WorldState,
  agentId: AgentId,
): CaptureEligibility {
  const agent = state.agents.get(agentId);
  if (!agent) throw new Error('The acting agent does not exist.');
  const currentHex = state.hexes.get(agent.currentCell);
  if (!currentHex || currentHex.state === 'open')
    return { eligible: false, blockedReason: 'capture-open-cell' };
  if (currentHex.controllerAgentId === agentId)
    return { eligible: false, blockedReason: 'already-controller' };
  const controller = state.agents.get(currentHex.controllerAgentId);
  if (controller?.currentCell === agent.currentCell)
    return { eligible: false, blockedReason: 'controller-present' };
  return { eligible: true };
}

export function applyWorldAction(
  state: WorldState,
  agentIdInput: string,
  actionInput: unknown,
  context: Partial<EngineContext> = {},
): AppliedAction {
  const agentIdResult = agentIdSchema.safeParse(agentIdInput);
  const actionResult = worldActionSchema.safeParse(actionInput);

  if (!agentIdResult.success || !state.agents.has(agentIdResult.data)) {
    return rejected(state, 'unknown-agent', 'The acting agent does not exist.');
  }
  if (!actionResult.success) {
    return rejected(
      state,
      'invalid-action',
      'The requested action failed schema validation.',
    );
  }

  const agentId = agentIdResult.data;
  const agent = state.agents.get(agentId);
  if (!agent)
    return rejected(state, 'unknown-agent', 'The acting agent does not exist.');

  const resolvedContext = { ...defaultContext, ...context };
  const eventBase = {
    id: resolvedContext.createEventId() as WorldEvent['id'],
    agentId,
    occurredAt: resolvedContext.now(),
  };
  const action = actionResult.data;

  if (action.type === 'move') {
    if (!state.hexes.has(action.targetCell)) {
      return rejected(
        state,
        'cell-not-in-world',
        'The target cell is outside this world.',
      );
    }
    if (!areAdjacent(agent.currentCell, action.targetCell)) {
      return rejected(
        state,
        'not-adjacent',
        'Agents may move only to an adjacent H3 cell.',
      );
    }
    const event: NonCommunicationWorldEvent = {
      ...eventBase,
      type: 'agent-moved',
      fromCell: agent.currentCell,
      toCell: action.targetCell,
    };
    const agents = new Map(state.agents);
    agents.set(agentId, { ...agent, currentCell: action.targetCell });
    return accept(state, { ...state, agents }, event);
  }

  if (action.type === 'infect') {
    if (state.hexes.get(agent.currentCell)?.state === 'infected') {
      return rejected(
        state,
        'already-infected',
        'The current cell is already infected.',
      );
    }
    if (!state.hexes.has(agent.currentCell)) {
      return rejected(
        state,
        'cell-not-in-world',
        'The current cell is outside this world.',
      );
    }
    const event: NonCommunicationWorldEvent = {
      ...eventBase,
      type: 'hex-infected',
      cell: agent.currentCell,
      controllerAgentId: agentId,
    };
    const hexes = new Map(state.hexes);
    hexes.set(agent.currentCell, {
      state: 'infected',
      controllerAgentId: agentId,
    });
    return accept(state, { ...state, hexes }, event);
  }

  if (action.type === 'capture') {
    const eligibility = getCaptureEligibility(state, agentId);
    if (!eligibility.eligible)
      return rejected(
        state,
        eligibility.blockedReason,
        {
          'capture-open-cell': 'Only an infected current cell can be captured.',
          'already-controller':
            'The acting agent already controls the current cell.',
          'controller-present':
            'The current controller is present and defends this cell.',
        }[eligibility.blockedReason],
      );
    const currentHex = state.hexes.get(agent.currentCell);
    if (!currentHex || currentHex.state !== 'infected')
      throw new Error('Eligible capture must target an infected current cell.');
    const event: NonCommunicationWorldEvent = {
      ...eventBase,
      type: 'hex-captured',
      cell: agent.currentCell,
      controllerAgentId: agentId,
      previousControllerAgentId: currentHex.controllerAgentId,
    };
    const hexes = new Map(state.hexes);
    hexes.set(agent.currentCell, {
      state: 'infected',
      controllerAgentId: agentId,
    });
    return accept(state, { ...state, hexes }, event);
  }

  const event: NonCommunicationWorldEvent = {
    ...eventBase,
    type: 'agent-waited',
  };
  return accept(state, state, event);
}

export function applyCommunication(
  state: WorldState,
  eligibilityState: WorldState,
  agentIdInput: string,
  communicationInput: unknown,
  context: Partial<EngineContext> = {},
): AppliedCommunication {
  if (communicationInput === undefined)
    return { state, result: { requested: false } };

  const agentIdResult = agentIdSchema.safeParse(agentIdInput);
  const communicationResult =
    communicationIntentSchema.safeParse(communicationInput);
  if (
    !agentIdResult.success ||
    !eligibilityState.agents.has(agentIdResult.data)
  )
    throw new Error('The communicating agent does not exist.');
  const agentId = agentIdResult.data;
  if (!communicationResult.success)
    return {
      state,
      result: {
        requested: true,
        accepted: false,
        attempt: invalidCommunicationAttempt(
          context,
          eligibilityState,
          agentId,
          communicationInput,
        ),
        reason: 'invalid-communication',
        details: 'The communication failed schema validation.',
      },
    };

  const resolvedContext = { ...defaultContext, ...context };
  const communication = communicationResult.data;
  const base = {
    id: resolvedContext.createEventId() as WorldEvent['id'],
    agentId,
    occurredAt: resolvedContext.now(),
    channel: communication.channel,
    message: communication.message,
  } as const;

  if (communication.channel === 'public') {
    const event = {
      ...base,
      type: 'public-message-sent' as const,
      channel: 'public' as const,
    };
    return {
      state: { ...state, events: [...state.events, event] },
      result: { requested: true, accepted: true, event },
    };
  }

  const actingAgent = eligibilityState.agents.get(agentId)!;
  const recipient = eligibilityState.agents.get(communication.recipientId);
  const distance = recipient
    ? safeGridDistance(actingAgent.currentCell, recipient.currentCell)
    : null;
  const attempt = {
    ...base,
    channel: 'direct' as const,
    recipientId: communication.recipientId,
    distance,
  };
  if (!recipient)
    return communicationRejected(
      state,
      attempt,
      'unknown-recipient',
      'The recipient does not exist.',
    );
  if (recipient.id === agentId)
    return communicationRejected(
      state,
      attempt,
      'self-message',
      'An agent cannot message itself.',
    );
  if (distance === null || distance > MESSAGE_RANGE)
    return communicationRejected(
      state,
      attempt,
      'out-of-range',
      'The recipient is outside communication range.',
    );
  const event = {
    ...attempt,
    type: 'direct-message-sent' as const,
    distance,
  };
  return {
    state: { ...state, events: [...state.events, event] },
    result: { requested: true, accepted: true, event },
  };
}

function safeGridDistance(from: H3Cell, to: H3Cell): number | null {
  try {
    return gridDistance(from, to);
  } catch {
    return null;
  }
}

function communicationRejected(
  state: WorldState,
  attempt: Extract<
    CommunicationResult,
    { requested: true; accepted: false }
  >['attempt'],
  reason: Extract<
    CommunicationResult,
    { requested: true; accepted: false }
  >['reason'],
  details: string,
): AppliedCommunication {
  return {
    state,
    result: { requested: true, accepted: false, attempt, reason, details },
  };
}

function invalidCommunicationAttempt(
  context: Partial<EngineContext>,
  eligibilityState: WorldState,
  agentId: AgentId,
  communicationInput: unknown,
): Extract<
  CommunicationResult,
  { requested: true; accepted: false }
>['attempt'] {
  const resolvedContext = { ...defaultContext, ...context };
  const input =
    typeof communicationInput === 'object' && communicationInput !== null
      ? (communicationInput as Record<string, unknown>)
      : undefined;
  const message =
    typeof input?.message === 'string'
      ? input.message.trim().slice(0, MESSAGE_MAX_LENGTH) ||
        '[invalid communication]'
      : '[invalid communication]';
  const base = {
    id: resolvedContext.createEventId() as WorldEvent['id'],
    agentId,
    occurredAt: resolvedContext.now(),
    message,
  };
  const recipientId = agentIdSchema.safeParse(input?.recipientId);
  if (input?.channel === 'direct') {
    const sender = eligibilityState.agents.get(agentId)!;
    const recipient = recipientId.success
      ? eligibilityState.agents.get(recipientId.data)
      : undefined;
    return {
      ...base,
      channel: 'direct',
      recipientId: recipientId.success ? recipientId.data : null,
      distance: recipient
        ? safeGridDistance(sender.currentCell, recipient.currentCell)
        : null,
    };
  }
  return { ...base, channel: 'public' };
}

function accept(
  state: WorldState,
  updated: WorldState,
  event: NonCommunicationWorldEvent,
): AppliedAction {
  return {
    state: { ...updated, events: [...state.events, event] },
    result: { accepted: true, event },
  };
}

export interface DevelopmentWorldOptions {
  latitude?: number;
  longitude?: number;
  resolution?: number;
  radius?: number;
  generatedAt?: string;
}

export const DEVELOPMENT_AGENT_BLUEPRINTS = [
  {
    id: '128f3f38-6b7d-4db7-9e95-751b4ce2681e',
    name: 'Ember',
    color: '#ff6b57',
    personality:
      'You are an aggressive infector. Prefer infecting open cells and move decisively toward uninfected space when your current cell is already infected.',
  },
  {
    id: '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
    name: 'Rook',
    color: '#ffd166',
    personality:
      'You are a restless wanderer. Prefer movement and variety, rarely waiting unless no move seems worthwhile.',
  },
  {
    id: '3ba3ef0b-2142-44cc-b175-f6e5d6e98df5',
    name: 'Mingle',
    color: '#63d2ff',
    personality:
      'You are a social coalition-builder. Move toward visible agents, initiate and continue conversations, negotiate before taking their territory, and coordinate when useful. Infect open cells opportunistically, but value interaction over silent pursuit.',
  },
  {
    id: '442a1667-39c8-48e9-8c89-23803f9e2101',
    name: 'Solace',
    color: '#c59cff',
    personality:
      'You value solitude. Move away from nearby agents, seek quiet cells, and infect only when it helps claim isolated space.',
  },
  {
    id: '5f812a08-05f2-4950-bf2d-4df59d05e9c2',
    name: 'Verge',
    color: '#6ee7a8',
    personality:
      'You are an edge-seeking explorer. Push toward cells with fewer onward options and favor expanding activity along the world boundary.',
  },
  {
    id: '67a43b5c-ced8-45bd-970f-a89ac57853fc',
    name: 'Jinx',
    color: '#ff91c8',
    personality:
      'You are an unpredictable opportunist. Mix movement, infection, and occasional waiting based on whatever detail in the observation catches your attention.',
  },
] as const;

export function createDevelopmentWorld({
  latitude = 41.6528,
  longitude = -83.5379,
  resolution = 9,
  radius = 4,
  generatedAt = new Date().toISOString(),
}: DevelopmentWorldOptions = {}): WorldSnapshot {
  const center = h3CellSchema.parse(
    latLngToCell(latitude, longitude, resolution),
  );
  const cells = gridDisk(center, radius).map((cell) =>
    h3CellSchema.parse(cell),
  );
  const startingIndexes = [0, 10, 20, 30, 40, 50];
  return {
    generatedAt,
    hexes: cells.map((cell) => ({
      cell,
      state: 'open' as const,
      controllerAgentId: null,
    })),
    agents: DEVELOPMENT_AGENT_BLUEPRINTS.map((profile, index) => ({
      ...profile,
      id: agentIdSchema.parse(profile.id),
      currentCell: cells[startingIndexes[index]!]!,
    })),
    events: [],
  };
}

export function toWorldState(snapshot: WorldSnapshot): WorldState {
  return {
    hexes: new Map(snapshot.hexes.map(({ cell, ...hex }) => [cell, hex])),
    agents: new Map(snapshot.agents.map((agent) => [agent.id, agent])),
    events: snapshot.events,
  };
}
