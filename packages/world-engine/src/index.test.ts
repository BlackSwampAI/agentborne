import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { agentIdSchema, h3CellSchema, type Agent } from '@agentborne/shared';
import {
  applyCommunication,
  applyWorldAction,
  areAdjacent,
  createDevelopmentWorld,
  getCaptureEligibility,
  toWorldState,
} from '.';

const agentId = agentIdSchema.parse('ca0e2b4d-d88f-4c9e-a401-a7b740c6e5af');
const center = h3CellSchema.parse(latLngToCell(41.6528, -83.5379, 9));
const adjacent = h3CellSchema.parse(gridDisk(center, 1)[1]);
const distant = h3CellSchema.parse(
  gridDisk(center, 2).find((cell) => gridDistance(center, cell) === 2),
);
const recipientId = agentIdSchema.parse('2507bb46-7ae4-45ca-8dda-644c4f85ca14');
const thirdAgentId = agentIdSchema.parse(
  '3ba3ef0b-2142-44cc-b175-f6e5d6e98df5',
);
const agent: Agent = {
  id: agentId,
  name: 'Morrow',
  color: '#ff6b57',
  personality: 'Moves deliberately.',
  currentCell: center,
};
const context = {
  createEventId: () => '67aa21b9-fc78-4b04-9f92-9862bf346f96',
  now: () => '2026-08-13T12:00:00.000Z',
};

function stateWithAgent() {
  const base = toWorldState(
    createDevelopmentWorld({ generatedAt: '2026-08-13T12:00:00.000Z' }),
  );
  return { ...base, agents: new Map([[agentId, agent]]) };
}

function stateWithRecipientAt(distance: number) {
  const before = stateWithAgent();
  const recipientCell = h3CellSchema.parse(
    gridDisk(center, distance).find(
      (cell) => gridDistance(center, cell) === distance,
    ),
  );
  return {
    ...before,
    agents: new Map([
      [agentId, agent],
      [
        recipientId,
        {
          ...agent,
          id: recipientId,
          name: 'Rook',
          currentCell: recipientCell,
        },
      ],
    ]),
  };
}

describe('H3 movement', () => {
  it('recognizes adjacent cells', () =>
    expect(areAdjacent(center, adjacent)).toBe(true));

  it('moves to an adjacent world cell and emits an event', () => {
    const result = applyWorldAction(
      stateWithAgent(),
      agentId,
      { type: 'move', targetCell: adjacent },
      context,
    );
    expect(result.result).toMatchObject({
      accepted: true,
      event: { type: 'agent-moved', fromCell: center, toCell: adjacent },
    });
    expect(result.state.agents.get(agentId)?.currentCell).toBe(adjacent);
  });

  it('rejects non-adjacent movement without changing state', () => {
    const before = stateWithAgent();
    const result = applyWorldAction(
      before,
      agentId,
      { type: 'move', targetCell: distant },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({
      accepted: false,
      reason: 'not-adjacent',
    });
  });
});

describe('infection', () => {
  it('infects the current open cell and produces an event', () => {
    const before = stateWithAgent();
    const openCell = [...before.hexes.entries()].find(
      ([, value]) => value.state === 'open',
    )?.[0];
    if (!openCell) throw new Error('fixture needs an open cell');
    const positioned = {
      ...before,
      agents: new Map([[agentId, { ...agent, currentCell: openCell }]]),
    };
    const result = applyWorldAction(
      positioned,
      agentId,
      { type: 'infect' },
      context,
    );
    expect(result.result).toMatchObject({
      accepted: true,
      event: { type: 'hex-infected', cell: openCell },
    });
    expect(result.state.hexes.get(openCell)).toEqual({
      state: 'infected',
      controllerAgentId: agentId,
    });
    expect(result.result).toMatchObject({
      event: { controllerAgentId: agentId },
    });
  });

  it('rejects repeated infection', () => {
    const infected = applyWorldAction(
      stateWithAgent(),
      agentId,
      { type: 'infect' },
      context,
    );
    const result = applyWorldAction(
      infected.state,
      agentId,
      { type: 'infect' },
      context,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      reason: 'already-infected',
    });
  });

  it('persists infection after the agent moves away', () => {
    const before = stateWithAgent();
    const infected = applyWorldAction(
      before,
      agentId,
      { type: 'infect' },
      context,
    );
    const moved = applyWorldAction(
      infected.state,
      agentId,
      { type: 'move', targetCell: adjacent },
      context,
    );
    expect(moved.state.hexes.get(center)).toEqual({
      state: 'infected',
      controllerAgentId: agentId,
    });
    expect(moved.state.agents.get(agentId)?.currentCell).toBe(adjacent);
  });
});

describe('capture', () => {
  function contestedState(controllerPresent = true) {
    const before = stateWithRecipientAt(0);
    const hexes = new Map(before.hexes);
    hexes.set(center, {
      state: 'infected' as const,
      controllerAgentId: recipientId,
    });
    if (controllerPresent) return { ...before, hexes };
    const agents = new Map(before.agents);
    agents.set(recipientId, {
      ...agents.get(recipientId)!,
      currentCell: adjacent,
    });
    return { ...before, hexes, agents };
  }

  it('reports open, self-controlled, defended, and abandoned eligibility', () => {
    expect(getCaptureEligibility(stateWithAgent(), agentId)).toEqual({
      eligible: false,
      blockedReason: 'capture-open-cell',
    });
    const selfControlled = {
      ...stateWithAgent(),
      hexes: new Map(stateWithAgent().hexes).set(center, {
        state: 'infected' as const,
        controllerAgentId: agentId,
      }),
    };
    expect(getCaptureEligibility(selfControlled, agentId)).toEqual({
      eligible: false,
      blockedReason: 'already-controller',
    });
    expect(getCaptureEligibility(contestedState(), agentId)).toEqual({
      eligible: false,
      blockedReason: 'controller-present',
    });
    expect(getCaptureEligibility(contestedState(false), agentId)).toEqual({
      eligible: true,
    });
  });

  it('transfers current infected-cell control without movement or infection-count change', () => {
    const before = contestedState(false);
    const infectedBefore = [...before.hexes.values()].filter(
      ({ state }) => state === 'infected',
    ).length;
    const result = applyWorldAction(
      before,
      agentId,
      { type: 'capture' },
      context,
    );
    expect(result.result).toMatchObject({
      accepted: true,
      event: {
        type: 'hex-captured',
        cell: center,
        controllerAgentId: agentId,
        previousControllerAgentId: recipientId,
      },
    });
    expect(result.state.agents).toBe(before.agents);
    expect(result.state.agents.get(agentId)?.currentCell).toBe(center);
    expect(result.state.hexes.get(center)).toEqual({
      state: 'infected',
      controllerAgentId: agentId,
    });
    expect(
      [...result.state.hexes.values()].filter(
        ({ state }) => state === 'infected',
      ),
    ).toHaveLength(infectedBefore);
  });

  it('does not require the previous controller to remain present', () => {
    const before = contestedState(false);
    const result = applyWorldAction(
      before,
      agentId,
      { type: 'capture' },
      context,
    );
    expect(result.result).toMatchObject({ accepted: true });
  });

  it('rejects capture while the current controller is physically present', () => {
    const before = contestedState();
    const result = applyWorldAction(
      before,
      agentId,
      { type: 'capture' },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.state.events).toHaveLength(0);
    expect(result.result).toMatchObject({
      accepted: false,
      reason: 'controller-present',
    });
  });

  it('allows capture with a present third agent when the controller is absent', () => {
    const before = contestedState(false);
    const agents = new Map(before.agents).set(thirdAgentId, {
      ...agent,
      id: thirdAgentId,
      name: 'Mingle',
      currentCell: center,
    });
    const result = applyWorldAction(
      { ...before, agents },
      agentId,
      { type: 'capture' },
      context,
    );
    expect(result.result).toMatchObject({ accepted: true });
  });

  it('prevents immediate same-cell recapture while the new controller remains', () => {
    const abandoned = contestedState(false);
    const captured = applyWorldAction(
      abandoned,
      agentId,
      { type: 'capture' },
      context,
    );
    const returned = applyWorldAction(
      captured.state,
      recipientId,
      { type: 'move', targetCell: center },
      context,
    );
    const recapture = applyWorldAction(
      returned.state,
      recipientId,
      { type: 'capture' },
      context,
    );
    expect(recapture.result).toMatchObject({
      accepted: false,
      reason: 'controller-present',
    });
    expect(recapture.state).toBe(returned.state);
    expect(recapture.state.hexes.get(center)).toMatchObject({
      controllerAgentId: agentId,
    });
  });

  it.each([
    [stateWithAgent(), 'capture-open-cell'],
    [
      {
        ...stateWithAgent(),
        hexes: new Map(stateWithAgent().hexes).set(center, {
          state: 'infected' as const,
          controllerAgentId: agentId,
        }),
      },
      'already-controller',
    ],
  ] as const)('rejects invalid capture without mutation', (before, reason) => {
    const result = applyWorldAction(
      before,
      agentId,
      { type: 'capture' },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({ accepted: false, reason });
  });
});

describe('nearby messaging', () => {
  it.each([0, 1, 3])(
    'delivers at inclusive grid distance %s without moving or infecting',
    (distance) => {
      const before = stateWithRecipientAt(distance);
      const result = applyCommunication(
        before,
        before,
        agentId,
        {
          channel: 'direct',
          recipientId,
          message: '  Hold this position.  ',
        },
        context,
      );
      expect(result.result).toMatchObject({
        accepted: true,
        event: {
          type: 'direct-message-sent',
          agentId,
          recipientId,
          message: 'Hold this position.',
          distance,
        },
      });
      expect(result.state.agents).toBe(before.agents);
      expect(result.state.hexes).toBe(before.hexes);
      expect(result.state.events).toHaveLength(1);
    },
  );

  it('rejects distance four without creating or delivering an event', () => {
    const before = stateWithRecipientAt(4);
    const result = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'direct', recipientId, message: 'Too far.' },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({
      accepted: false,
      reason: 'out-of-range',
    });
    expect(result.state.events).toHaveLength(0);
  });

  it.each([
    [agentId, 'self-message'],
    ['6b58a30d-5d47-4ea3-8c1c-43edcc919553', 'unknown-recipient'],
  ] as const)('rejects invalid recipient %s as %s', (target, reason) => {
    const before = stateWithRecipientAt(1);
    const result = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'direct', recipientId: target, message: 'Hello.' },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({ accepted: false, reason });
    expect(result.state.events).toHaveLength(0);
  });

  it('publishes trimmed world chat without a recipient or range check', () => {
    const before = stateWithRecipientAt(4);
    const result = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'public', message: '  Hello, world.  ' },
      context,
    );
    expect(result.result).toMatchObject({
      requested: true,
      accepted: true,
      event: {
        type: 'public-message-sent',
        channel: 'public',
        message: 'Hello, world.',
      },
    });
  });
});

describe('wait and deterministic development world', () => {
  it('records a wait without changing cells or hex states', () => {
    const before = stateWithAgent();
    const result = applyWorldAction(before, agentId, { type: 'wait' }, context);
    expect(result.result).toMatchObject({
      accepted: true,
      event: { type: 'agent-waited' },
    });
    expect(result.state.hexes).toBe(before.hexes);
    expect(result.state.agents).toBe(before.agents);
  });

  it('constructs the same 61 cells and six valid named agents', () => {
    const first = createDevelopmentWorld({ generatedAt: context.now() });
    const second = createDevelopmentWorld({ generatedAt: context.now() });
    expect(first).toEqual(second);
    expect(first.hexes).toHaveLength(61);
    expect(
      first.hexes.every(
        (hex) => hex.state === 'open' && hex.controllerAgentId === null,
      ),
    ).toBe(true);
    expect(first.agents).toHaveLength(6);
    expect(new Set(first.agents.map(({ id }) => id)).size).toBe(6);
    expect(
      first.agents.every(({ currentCell }) =>
        first.hexes.some(({ cell }) => cell === currentCell),
      ),
    ).toBe(true);
    expect(first.agents.find(({ name }) => name === 'Mingle')).toMatchObject({
      id: '3ba3ef0b-2142-44cc-b175-f6e5d6e98df5',
      color: '#63d2ff',
      currentCell: first.hexes[20]!.cell,
      personality:
        'You are a social coalition-builder. Move toward visible agents, initiate and continue conversations, negotiate before taking their territory, and coordinate when useful. Infect open cells opportunistically, but value interaction over silent pursuit.',
    });
  });
});
