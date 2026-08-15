import type { AgentId, SimulationSnapshot } from '@agentborne/shared';

export const neutralAgentColor = '#b2d3a8';

export function resolveAgentColor(
  snapshot: Pick<SimulationSnapshot, 'world'>,
  agentId: AgentId,
  retainedEffectiveColor?: string | null,
): string {
  const agent = snapshot.world.agents.find(({ id }) => id === agentId);
  const currentAlliance = snapshot.world.alliances.find(({ memberAgentIds }) =>
    memberAgentIds.includes(agentId),
  );
  return (
    currentAlliance?.color ??
    retainedEffectiveColor ??
    agent?.color ??
    neutralAgentColor
  );
}
