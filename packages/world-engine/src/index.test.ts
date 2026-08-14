import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { agentIdSchema, h3CellSchema, type Agent } from '@agentborne/shared';
import {
  applyRequestedAction,
  areAdjacent,
  createDevelopmentWorld,
  toWorldState,
} from '.';

const agentId = agentIdSchema.parse('ca0e2b4d-d88f-4c9e-a401-a7b740c6e5af');
const center = h3CellSchema.parse(latLngToCell(41.6528, -83.5379, 9));
const adjacent = h3CellSchema.parse(gridDisk(center, 1)[1]);
const distant = h3CellSchema.parse(
  gridDisk(center, 2).find((cell) => gridDistance(center, cell) === 2),
);
const recipientId = agentIdSchema.parse('2507bb46-7ae4-45ca-8dda-644c4f85ca14');
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
    const result = applyRequestedAction(
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
    const result = applyRequestedAction(
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
      ([, value]) => value === 'open',
    )?.[0];
    if (!openCell) throw new Error('fixture needs an open cell');
    const positioned = {
      ...before,
      agents: new Map([[agentId, { ...agent, currentCell: openCell }]]),
    };
    const result = applyRequestedAction(
      positioned,
      agentId,
      { type: 'infect' },
      context,
    );
    expect(result.result).toMatchObject({
      accepted: true,
      event: { type: 'hex-infected', cell: openCell },
    });
    expect(result.state.hexes.get(openCell)).toBe('infected');
  });

  it('rejects repeated infection', () => {
    const infected = applyRequestedAction(
      stateWithAgent(),
      agentId,
      { type: 'infect' },
      context,
    );
    const result = applyRequestedAction(
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
    const infected = applyRequestedAction(
      before,
      agentId,
      { type: 'infect' },
      context,
    );
    const moved = applyRequestedAction(
      infected.state,
      agentId,
      { type: 'move', targetCell: adjacent },
      context,
    );
    expect(moved.state.hexes.get(center)).toBe('infected');
    expect(moved.state.agents.get(agentId)?.currentCell).toBe(adjacent);
  });
});

describe('nearby messaging', () => {
  it.each([0, 1, 3])(
    'delivers at inclusive grid distance %s without moving or infecting',
    (distance) => {
      const before = stateWithRecipientAt(distance);
      const result = applyRequestedAction(
        before,
        agentId,
        {
          type: 'message',
          recipientId,
          message: '  Hold this position.  ',
        },
        context,
      );
      expect(result.result).toMatchObject({
        accepted: true,
        event: {
          type: 'agent-messaged',
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
    const result = applyRequestedAction(
      before,
      agentId,
      { type: 'message', recipientId, message: 'Too far.' },
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
    const result = applyRequestedAction(
      before,
      agentId,
      { type: 'message', recipientId: target, message: 'Hello.' },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({ accepted: false, reason });
    expect(result.state.events).toHaveLength(0);
  });
});

describe('wait and deterministic development world', () => {
  it('records a wait without changing cells or hex states', () => {
    const before = stateWithAgent();
    const result = applyRequestedAction(
      before,
      agentId,
      { type: 'wait' },
      context,
    );
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
    expect(first.agents).toHaveLength(6);
    expect(new Set(first.agents.map(({ id }) => id)).size).toBe(6);
    expect(
      first.agents.every(({ currentCell }) =>
        first.hexes.some(({ cell }) => cell === currentCell),
      ),
    ).toBe(true);
  });
});
