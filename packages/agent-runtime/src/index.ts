import { z } from 'zod';
import {
  agentIdSchema,
  h3CellSchema,
  requestedActionSchema,
  type RequestedAction,
} from '@agentborne/shared';

export const agentObservationSchema = z.object({
  agentId: agentIdSchema,
  currentCell: h3CellSchema,
  adjacentCells: z.array(h3CellSchema),
  nearbyAgentIds: z.array(agentIdSchema),
  recentMessages: z.array(z.string().max(1_000)),
});
export type AgentObservation = z.infer<typeof agentObservationSchema>;

export const agentDecisionSchema = z.object({
  requestedAction: requestedActionSchema,
  summary: z.string().trim().min(1).max(500),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

/**
 * Providers receive structured observations and return a requested action.
 * They never receive a mutable world handle and cannot apply consequences.
 */
export interface AgentProvider {
  decide(observation: AgentObservation): Promise<AgentDecision>;
}

export interface ScriptedDecision {
  requestedAction: RequestedAction;
  summary: string;
}

export class ScriptedAgentProvider implements AgentProvider {
  readonly #decisions: ScriptedDecision[];
  #cursor = 0;

  constructor(decisions: ScriptedDecision[]) {
    if (decisions.length === 0) {
      throw new Error('ScriptedAgentProvider requires at least one decision.');
    }
    this.#decisions = decisions.map((decision) =>
      agentDecisionSchema.parse(decision),
    );
  }

  async decide(observation: AgentObservation): Promise<AgentDecision> {
    agentObservationSchema.parse(observation);
    const decision = this.#decisions[this.#cursor];
    if (!decision)
      throw new Error('ScriptedAgentProvider has no decisions remaining.');
    this.#cursor += 1;
    return structuredClone(decision);
  }
}
