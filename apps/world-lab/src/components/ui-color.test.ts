import { describe, expect, it } from 'vitest';
import type { AgentId, SimulationSnapshot } from '@agentborne/shared';
import { neutralAgentColor, resolveAgentColor } from './ui-color';

const agentId = '11111111-1111-4111-8111-111111111111' as AgentId;
const otherId = '22222222-2222-4222-8222-222222222222' as AgentId;
const state = (allied: boolean) =>
  ({
    world: {
      agents: [{ id: agentId, color: '#123456' }],
      alliances: allied
        ? [{ color: '#abcdef', memberAgentIds: [agentId] }]
        : [],
    },
  }) as unknown as Pick<SimulationSnapshot, 'world'>;

describe('effective agent color resolution', () => {
  it('prefers current alliance color and updates when membership changes', () => {
    expect(resolveAgentColor(state(true), agentId, '#654321')).toBe('#abcdef');
    expect(resolveAgentColor(state(false), agentId, '#654321')).toBe('#654321');
  });

  it('falls back through retained, base, and neutral colors', () => {
    expect(resolveAgentColor(state(false), agentId)).toBe('#123456');
    expect(resolveAgentColor(state(false), otherId, '#654321')).toBe('#654321');
    expect(resolveAgentColor(state(false), otherId)).toBe(neutralAgentColor);
  });
});
