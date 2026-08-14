import { describe, expect, it } from 'vitest';
import { agentIdSchema, h3CellSchema } from '@agentborne/shared';
import { ScriptedAgentProvider } from '.';

const observation = {
  agentId: agentIdSchema.parse('ca0e2b4d-d88f-4c9e-a401-a7b740c6e5af'),
  currentCell: h3CellSchema.parse('892a1072893ffff'),
  adjacentCells: [],
  nearbyAgentIds: [],
  recentMessages: [],
};

describe('ScriptedAgentProvider', () => {
  it('returns validated decisions in order without a mutable world dependency', async () => {
    const provider = new ScriptedAgentProvider([
      {
        requestedAction: { type: 'wait' },
        summary: 'Staying still to observe.',
      },
      {
        requestedAction: { type: 'infect' },
        summary: 'Marking the current cell.',
      },
    ]);

    await expect(provider.decide(observation)).resolves.toMatchObject({
      requestedAction: { type: 'wait' },
    });
    await expect(provider.decide(observation)).resolves.toMatchObject({
      requestedAction: { type: 'infect' },
    });
  });

  it('rejects an empty script', () => {
    expect(() => new ScriptedAgentProvider([])).toThrow(
      /at least one decision/,
    );
  });
});
