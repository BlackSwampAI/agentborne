import { z } from 'zod';
import { WORLD_SCENARIO_LIMITS } from './limits';
import type { AgentId } from './index';

export const BEHAVIOR_REGISTRY_VERSION = 1 as const;

export const PERSONALITY_PROFILES = [
  {
    id: 'diplomatic',
    label: 'Diplomatic',
    description: 'Warm, cooperative, and consensus-oriented.',
    prompt:
      'Communicate warmly, cooperatively, and with a preference for consensus.',
  },
  {
    id: 'direct',
    label: 'Direct',
    description: 'Blunt, concise, and open about intentions.',
    prompt:
      'Communicate bluntly and concisely; be open about immediate intentions when useful.',
  },
  {
    id: 'guarded',
    label: 'Guarded',
    description: 'Reveals little and avoids premature commitments.',
    prompt:
      'Reveal little, communicate carefully, and avoid premature commitments.',
  },
  {
    id: 'charismatic',
    label: 'Charismatic',
    description: 'Persuasive, expressive, and relationship-focused.',
    prompt:
      'Communicate persuasively and expressively, with attention to relationships.',
  },
  {
    id: 'analytical',
    label: 'Analytical',
    description: 'Precise, observant, and focused on concrete world state.',
    prompt:
      'Communicate precisely and ground statements in concrete observed world state.',
  },
  {
    id: 'playful',
    label: 'Playful',
    description: 'Teasing and imaginative without ignoring legality.',
    prompt:
      'Use a playful, imaginative voice while remaining clear and within the legal contract.',
  },
] as const;

export const STRATEGY_PROFILES = [
  {
    id: 'expansionist',
    label: 'Expansionist',
    description: 'Prefers efficient uncontested growth.',
    prompt:
      'Prefer efficient uncontested territorial growth when it is available.',
  },
  {
    id: 'territorial',
    label: 'Territorial',
    description: 'Values consolidation and nearby threats.',
    prompt:
      'Value consolidation and respond to nearby threats to controlled territory.',
  },
  {
    id: 'coalition-builder',
    label: 'Coalition builder',
    description: 'Looks for beneficial formal alliances.',
    prompt:
      'Look for beneficial formal alliances when authoritative diplomacy options permit them.',
  },
  {
    id: 'opportunist',
    label: 'Opportunist',
    description: 'Exploits temporary openings and changing balances.',
    prompt: 'Exploit temporary legal openings and changing power balances.',
  },
  {
    id: 'disruptor',
    label: 'Disruptor',
    description: 'Pressures leaders and checks runaway control.',
    prompt:
      'Pressure territory leaders and look for legal ways to prevent runaway control.',
  },
  {
    id: 'adaptive',
    label: 'Adaptive',
    description: 'Frequently reassesses the best available approach.',
    prompt:
      'Frequently reassess and choose whichever legal approach currently offers progress.',
  },
] as const;

export const personalityProfileIdSchema = z.enum(
  PERSONALITY_PROFILES.map(({ id }) => id),
);
export const strategyProfileIdSchema = z.enum(
  STRATEGY_PROFILES.map(({ id }) => id),
);
export type PersonalityProfileId = z.infer<typeof personalityProfileIdSchema>;
export type StrategyProfileId = z.infer<typeof strategyProfileIdSchema>;
export const behaviorAssignmentModeSchema = z.enum([
  'balanced-random',
  'fully-random',
  'manual',
]);
export type BehaviorAssignmentMode = z.infer<
  typeof behaviorAssignmentModeSchema
>;
export const behaviorAssignmentSchema = z
  .object({
    agentId: z.string().uuid().brand<'AgentId'>(),
    personalityId: personalityProfileIdSchema,
    strategyId: strategyProfileIdSchema,
    manual: z.boolean().default(false),
  })
  .strict();
export type BehaviorAssignment = z.infer<typeof behaviorAssignmentSchema>;
export const behaviorConfigurationSchema = z
  .object({
    registryVersion: z.literal(BEHAVIOR_REGISTRY_VERSION),
    assignmentMode: behaviorAssignmentModeSchema,
    seed: z.string().trim().min(1).max(80),
    assignments: z
      .array(behaviorAssignmentSchema)
      .min(WORLD_SCENARIO_LIMITS.minimumAgents)
      .max(WORLD_SCENARIO_LIMITS.maximumAgents),
    locked: z.boolean(),
  })
  .strict()
  .refine(
    ({ assignments }) =>
      new Set(assignments.map(({ agentId }) => agentId)).size ===
      assignments.length,
    'Behavior assignments must have unique agents.',
  );
export type BehaviorConfiguration = z.infer<typeof behaviorConfigurationSchema>;

function seeded(seed: string) {
  let value = 2166136261;
  for (const char of seed)
    value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () =>
    (value = Math.imul(value ^ (value >>> 15), 2246822507) >>> 0) / 4294967296;
}
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

export function assignBehavior(
  agentIds: readonly AgentId[],
  seed: string,
  mode: Exclude<BehaviorAssignmentMode, 'manual'>,
): BehaviorAssignment[] {
  const random = seeded(`${BEHAVIOR_REGISTRY_VERSION}:${seed}`);
  const personalities = shuffle(
    PERSONALITY_PROFILES.map(({ id }) => id),
    random,
  );
  const strategies = shuffle(
    STRATEGY_PROFILES.map(({ id }) => id),
    random,
  );
  const pairs = new Set<string>();
  return agentIds.map((agentId, index) => {
    const personalityId =
      mode === 'balanced-random'
        ? personalities[index % personalities.length]!
        : PERSONALITY_PROFILES[
            Math.floor(random() * PERSONALITY_PROFILES.length)
          ]!.id;
    let strategyId =
      mode === 'balanced-random'
        ? strategies[index % strategies.length]!
        : STRATEGY_PROFILES[Math.floor(random() * STRATEGY_PROFILES.length)]!
            .id;
    for (
      let tries = 0;
      tries < 12 && pairs.has(`${personalityId}:${strategyId}`);
      tries++
    )
      strategyId =
        STRATEGY_PROFILES[Math.floor(random() * STRATEGY_PROFILES.length)]!.id;
    pairs.add(`${personalityId}:${strategyId}`);
    return { agentId, personalityId, strategyId, manual: false };
  });
}

export function behaviorPrompt(
  assignment: Pick<BehaviorAssignment, 'personalityId' | 'strategyId'>,
) {
  const personality = PERSONALITY_PROFILES.find(
    ({ id }) => id === assignment.personalityId,
  )!;
  const strategy = STRATEGY_PROFILES.find(
    ({ id }) => id === assignment.strategyId,
  )!;
  return { personality: personality.prompt, strategy: strategy.prompt };
}
