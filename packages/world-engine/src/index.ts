import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import {
  agentIdSchema,
  h3CellSchema,
  MESSAGE_RANGE,
  requestedActionSchema,
  type ActionResult,
  type Agent,
  type AgentId,
  type CaptureEligibility,
  type H3Cell,
  type RequestedAction,
  type WorldEvent,
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
  result: ActionResult;
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

export function applyRequestedAction(
  state: WorldState,
  agentIdInput: string,
  actionInput: unknown,
  context: Partial<EngineContext> = {},
): AppliedAction {
  const agentIdResult = agentIdSchema.safeParse(agentIdInput);
  const actionResult = requestedActionSchema.safeParse(actionInput);

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
    const event: WorldEvent = {
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
    const event: WorldEvent = {
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
    const event: WorldEvent = {
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

  if (action.type === 'message') {
    const recipient = state.agents.get(action.recipientId);
    if (!recipient) {
      return rejected(
        state,
        'unknown-recipient',
        'The recipient does not exist.',
      );
    }
    if (recipient.id === agentId) {
      return rejected(state, 'self-message', 'An agent cannot message itself.');
    }
    let distance: number;
    try {
      distance = gridDistance(agent.currentCell, recipient.currentCell);
    } catch {
      return rejected(
        state,
        'out-of-range',
        'The recipient is outside communication range.',
      );
    }
    if (distance > MESSAGE_RANGE) {
      return rejected(
        state,
        'out-of-range',
        'The recipient is outside communication range.',
      );
    }
    const event: WorldEvent = {
      ...eventBase,
      type: 'agent-messaged',
      recipientId: action.recipientId,
      message: action.message,
      distance,
    };
    return accept(state, state, event);
  }

  const event: WorldEvent = { ...eventBase, type: 'agent-waited' };
  return accept(state, state, event);
}

function accept(
  state: WorldState,
  updated: WorldState,
  event: WorldEvent,
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

export type { RequestedAction };
