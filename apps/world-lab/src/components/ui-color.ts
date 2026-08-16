import {
  NEUTRAL_AGENT_COLOR,
  type AgentId,
  type SimulationSnapshot,
} from '@agentborne/shared';

export const neutralAgentColor = NEUTRAL_AGENT_COLOR;

export function resolveAgentColor(
  snapshot: Pick<SimulationSnapshot, 'world'>,
  agentId: AgentId,
  _retainedEffectiveColor?: string | null,
): string {
  const currentAlliance = snapshot.world.alliances.find(({ memberAgentIds }) =>
    memberAgentIds.includes(agentId),
  );
  return currentAlliance?.color ?? neutralAgentColor;
}
