import { gridDisk, gridDistance, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { agentIdSchema, h3CellSchema, type Agent } from '@hexzero/shared';
import {
  applyCommunication,
  applyDiplomacy,
  applyWorldAction,
  areAdjacent,
  createDevelopmentWorld,
  getCaptureEligibility,
  expireAllianceProposals,
  seededTickIntervalMinutes,
  seededTickOrder,
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
  createAllianceId: () => 'a1111111-1111-4111-8111-111111111111',
  createProposalId: () => 'b2222222-2222-4222-8222-222222222222',
  now: () => '2026-08-13T12:00:00.000Z',
};

describe('simultaneous tick determinism', () => {
  it('reproduces a shuffled resolution order and inclusive virtual interval', () => {
    const ids = [agentId, recipientId, thirdAgentId];
    expect(seededTickOrder(ids, 'scenario-a', 7)).toEqual(
      seededTickOrder(ids, 'scenario-a', 7),
    );
    const interval = seededTickIntervalMinutes('scenario-a', 7, 5, 10);
    expect(interval).toBeGreaterThanOrEqual(5);
    expect(interval).toBeLessThanOrEqual(10);
    expect(interval).toBe(seededTickIntervalMinutes('scenario-a', 7, 5, 10));
  });
});

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
    'delivers by physical distance at former grid distance %s without moving or infecting',
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
        { ...context, communicationRangeKm: 100 },
      );
      expect(result.result).toMatchObject({
        accepted: true,
        event: {
          type: 'direct-message-sent',
          agentId,
          recipientId,
          message: 'Hold this position.',
        },
      });
      expect(result.state.agents).toBe(before.agents);
      expect(result.state.hexes).toBe(before.hexes);
      expect(result.state.events).toHaveLength(1);
      if (
        result.result.requested &&
        result.result.accepted &&
        result.result.event.channel === 'direct'
      )
        expect(result.result.event.distance).toBeGreaterThanOrEqual(0);
    },
  );

  it('rejects a recipient beyond the configured physical range', () => {
    const before = stateWithRecipientAt(4);
    const result = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'direct', recipientId, message: 'Too far.' },
      { ...context, communicationRangeKm: 0.001 },
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

  it.each([
    { channel: 'direct', recipientId: 'Verge', message: 'Hello.' },
    { channel: 'direct', message: 'Hello.' },
  ])('preserves a malformed direct attempt as direct', (communication) => {
    const before = stateWithRecipientAt(1);
    const result = applyCommunication(
      before,
      before,
      agentId,
      communication,
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({
      requested: true,
      accepted: false,
      reason: 'invalid-communication',
      attempt: {
        channel: 'direct',
        recipientId: null,
        message: 'Hello.',
        distance: null,
      },
    });
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

  it('rejects alliance communication for an unaffiliated sender without mutation', () => {
    const before = stateWithRecipientAt(1);
    const result = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'alliance', message: 'Private coordination.' },
      context,
    );
    expect(result.state).toBe(before);
    expect(result.result).toMatchObject({
      requested: true,
      accepted: false,
      reason: 'not-allied',
      attempt: { channel: 'alliance' },
    });
  });

  it('allows only Patient Zero to broadcast privately to every other active agent', () => {
    const before = stateWithRecipientAt(1);
    const rejected = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'zero', message: 'Separate the fronts.' },
      { ...context, patientZeroAgentId: recipientId },
    );
    expect(rejected.state).toBe(before);
    expect(rejected.result).toMatchObject({
      accepted: false,
      reason: 'not-patient-zero',
    });
    const delivered = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'zero', message: 'Separate the fronts.' },
      { ...context, patientZeroAgentId: agentId },
    );
    expect(delivered.result).toMatchObject({
      accepted: true,
      event: {
        channel: 'zero',
        recipientIds: [recipientId],
        playerVisible: false,
      },
    });
  });

  it('bypasses direct range only when Patient Zero is one endpoint', () => {
    const before = stateWithRecipientAt(4);
    const ordinary = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'direct', recipientId, message: 'Too far.' },
      { ...context, communicationRangeKm: 0.001 },
    );
    expect(ordinary.result).toMatchObject({
      accepted: false,
      reason: 'out-of-range',
    });
    const reply = applyCommunication(
      before,
      before,
      agentId,
      { channel: 'direct', recipientId, message: 'Directive received.' },
      {
        ...context,
        communicationRangeKm: 0.001,
        patientZeroAgentId: recipientId,
      },
    );
    expect(reply.result).toMatchObject({
      accepted: true,
      event: { channel: 'direct' },
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

  it('constructs the same 127 cells and eight valid named agents', () => {
    const first = createDevelopmentWorld({ generatedAt: context.now() });
    const second = createDevelopmentWorld({ generatedAt: context.now() });
    expect(first).toEqual(second);
    expect(first.hexes).toHaveLength(127);
    expect(
      first.hexes.every(
        (hex) => hex.state === 'open' && hex.controllerAgentId === null,
      ),
    ).toBe(true);
    expect(first.agents).toHaveLength(8);
    expect(new Set(first.agents.map(({ id }) => id)).size).toBe(8);
    expect(
      new Set(first.agents.map(({ currentCell }) => currentCell)).size,
    ).toBe(8);
    expect(
      first.agents.every(({ currentCell }) =>
        first.hexes.some(({ cell }) => cell === currentCell),
      ),
    ).toBe(true);
    expect(first.agents.find(({ name }) => name === 'Mingle')).toMatchObject({
      id: '3ba3ef0b-2142-44cc-b175-f6e5d6e98df5',
      color: '#63d2ff',
      currentCell: first.hexes[97]!.cell,
      personality:
        'You are a social coalition-builder. Seek agents, initiate and continue conversations, propose alliances, answer offers, negotiate borders, and coordinate captures against dominant rivals. Prefer cooperation and public diplomacy over silent expansion, but protect your own territory and leave an alliance that repeatedly ignores or exploits you. Make concrete proposals rather than merely announcing actions.',
    });
  });
});

describe('formal alliances', () => {
  it.each([
    { agentCount: 8, lifetime: 16 },
    { agentCount: 20, lifetime: 40 },
  ])(
    'preserves a $lifetime-turn legacy lifetime for an $agentCount-agent roster',
    ({ agentCount, lifetime }) => {
      const base = toWorldState(
        createDevelopmentWorld({ generatedAt: context.now() }),
      );
      const agents = [...base.agents.values()];
      for (let index = agents.length; index < agentCount; index += 1) {
        const id = agentIdSchema.parse(
          `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        );
        agents.push({ ...agents[0]!, id, name: `Agent ${index + 1}` });
      }
      const initial = {
        ...base,
        agents: new Map(agents.map((item) => [item.id, item])),
      };
      const [proposer, recipient] = agents;

      const proposed = applyDiplomacy(
        initial,
        proposer!.id,
        { type: 'propose-alliance', recipientId: recipient!.id },
        1,
        context,
      );
      const proposal = [
        ...proposed.state.pendingAllianceProposals!.values(),
      ][0]!;

      expect(proposal).toMatchObject({ expirationTurn: 1 + lifetime });
      expect(proposal.originatingTick).toBeUndefined();
    },
  );

  it('uses explicit two-tick expiry while retaining record ordinals', () => {
    const initial = toWorldState(
      createDevelopmentWorld({ generatedAt: context.now() }),
    );
    const [proposer, recipient] = [...initial.agents.values()];
    const proposed = applyDiplomacy(
      initial,
      proposer!.id,
      { type: 'propose-alliance', recipientId: recipient!.id },
      1,
      { ...context, tickNumber: 1 },
    );
    expect(
      [...proposed.state.pendingAllianceProposals!.values()][0],
    ).toMatchObject({
      originatingTurn: 1,
      expirationTurn: 17,
      originatingTick: 1,
      expirationTick: 3,
    });

    const afterFirstOpportunity = expireAllianceProposals(proposed.state, 2, {
      ...context,
      tickNumber: 2,
    });
    expect(afterFirstOpportunity.pendingAllianceProposals?.size).toBe(1);
    const expired = expireAllianceProposals(afterFirstOpportunity, 17, {
      ...context,
      tickNumber: 3,
    });
    expect(expired.pendingAllianceProposals?.size).toBe(0);
  });

  it('forms, colors, leaves, dissolves, and expires proposals deterministically', () => {
    const initial = toWorldState(
      createDevelopmentWorld({ generatedAt: context.now() }),
    );
    const [ember, rook, mingle] = [...initial.agents.values()];
    const proposed = applyDiplomacy(
      initial,
      ember!.id,
      { type: 'propose-alliance', recipientId: rook!.id },
      1,
      context,
    );
    expect(proposed.result).toMatchObject({ requested: true, accepted: true });
    const proposalId = [...proposed.state.pendingAllianceProposals!.keys()][0]!;
    const formed = applyDiplomacy(
      proposed.state,
      rook!.id,
      { type: 'accept-alliance', proposalId },
      2,
      context,
    );
    expect(formed.result).toMatchObject({
      requested: true,
      accepted: true,
      events: [{ type: 'alliance-formed', allianceColor: '#0072B2' }],
    });
    expect([...formed.state.alliances!.values()][0]?.memberAgentIds).toEqual([
      ember!.id,
      rook!.id,
    ]);
    const privateMessage = applyCommunication(
      formed.state,
      formed.state,
      ember!.id,
      { channel: 'alliance', message: 'Coordinate privately.' },
      { ...context, communicationRangeKm: 0.001 },
    );
    expect(privateMessage.result).toMatchObject({
      requested: true,
      accepted: true,
      event: {
        type: 'alliance-message-sent',
        recipientIds: [rook!.id],
      },
    });
    const invite = applyDiplomacy(
      formed.state,
      ember!.id,
      { type: 'propose-alliance', recipientId: mingle!.id },
      3,
      {
        ...context,
        createProposalId: () => 'c3333333-3333-4333-8333-333333333333',
      },
    );
    const inviteId = [...invite.state.pendingAllianceProposals!.keys()][0]!;
    const joined = applyDiplomacy(
      invite.state,
      mingle!.id,
      { type: 'accept-alliance', proposalId: inviteId },
      4,
      context,
    );
    expect(
      [...joined.state.alliances!.values()][0]?.memberAgentIds,
    ).toHaveLength(3);
    const left = applyDiplomacy(
      joined.state,
      rook!.id,
      { type: 'leave-alliance' },
      5,
      context,
    );
    expect([...left.state.alliances!.values()][0]?.memberAgentIds).toEqual([
      ember!.id,
      mingle!.id,
    ]);
    const dissolved = applyDiplomacy(
      left.state,
      mingle!.id,
      { type: 'leave-alliance' },
      6,
      context,
    );
    expect(dissolved.state.alliances?.size).toBe(0);
    const laterProposal = applyDiplomacy(
      dissolved.state,
      ember!.id,
      { type: 'propose-alliance', recipientId: rook!.id },
      10,
      context,
    );
    const expired = expireAllianceProposals(laterProposal.state, 26, context);
    expect(expired.pendingAllianceProposals?.size).toBe(0);
    expect(expired.events.at(-1)).toMatchObject({
      type: 'alliance-proposal-closed',
      reason: 'expired',
    });
  });
});
