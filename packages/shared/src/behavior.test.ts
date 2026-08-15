import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_REGISTRY_VERSION,
  PERSONALITY_PROFILES,
  STRATEGY_PROFILES,
  assignBehavior,
  behaviorConfigurationSchema,
  behaviorPrompt,
  type AgentId,
} from './index';

const ids = Array.from(
  { length: 8 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` as AgentId,
);

describe('behavior registry and assignment', () => {
  it('owns six unique versioned profiles in each independent dimension', () => {
    expect(BEHAVIOR_REGISTRY_VERSION).toBe(1);
    expect(new Set(PERSONALITY_PROFILES.map(({ id }) => id)).size).toBe(6);
    expect(new Set(STRATEGY_PROFILES.map(({ id }) => id)).size).toBe(6);
    expect(
      behaviorPrompt({ personalityId: 'direct', strategyId: 'adaptive' }),
    ).toEqual({
      personality: expect.stringContaining('bluntly'),
      strategy: expect.stringContaining('reassess'),
    });
  });

  it('is deterministic and balanced before profile repetition', () => {
    const first = assignBehavior(ids, 'experiment-a', 'balanced-random');
    expect(assignBehavior(ids, 'experiment-a', 'balanced-random')).toEqual(
      first,
    );
    expect(assignBehavior(ids, 'experiment-b', 'balanced-random')).not.toEqual(
      first,
    );
    expect(
      new Set(first.slice(0, 6).map(({ personalityId }) => personalityId)).size,
    ).toBe(6);
    expect(
      new Set(first.slice(0, 6).map(({ strategyId }) => strategyId)).size,
    ).toBe(6);
  });

  it('rejects imported IDs outside the registry allowlist', () => {
    const assignments = assignBehavior(ids, 'safe', 'balanced-random');
    expect(
      behaviorConfigurationSchema.safeParse({
        registryVersion: 1,
        assignmentMode: 'manual',
        seed: 'safe',
        locked: false,
        assignments: assignments.map((value, index) =>
          index ? value : { ...value, personalityId: 'injected prompt' },
        ),
      }).success,
    ).toBe(false);
  });
});
