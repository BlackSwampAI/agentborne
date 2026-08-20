import { describe, expect, it } from 'vitest';
import {
  appliedScenarioSchema,
  assignBehavior,
  behaviorConfigurationSchema,
  worldSetupPreviewResponseSchema,
  worldSetupRequestSchema,
  WORLD_SCENARIO_LIMITS,
} from './index';

const roster = [
  {
    id: '128f3f38-6b7d-4db7-9e95-751b4ce2681e',
    name: 'Ember',
    color: '#ff6b57',
    personality: 'Adaptive.',
  },
] as const;
const request = {
  scenarioVersion: 'world-scenario-v1' as const,
  center: { latitude: 41.6528, longitude: -83.5379 },
  resolution: 9,
  radius: 3,
  worldSeed: 'world',
  rosterSeed: 'roster',
  spawnSeed: 'spawn',
  minimumSpawnSeparation: 1,
  communicationRangeKm: 12,
  roster: [...roster],
  modelConfiguration: {
    globalModelId: null,
    globalReasoningProfile: 'provider-default' as const,
    overrides: [],
    locked: false,
  },
  behaviorConfiguration: {
    registryVersion: 1 as const,
    assignmentMode: 'balanced-random' as const,
    seed: 'behavior',
    assignments: assignBehavior(
      roster.map(({ id }) => id as never),
      'behavior',
      'balanced-random',
    ),
    locked: false,
  },
  objectiveVersion: 'durable-influence-v2' as const,
  capabilities: { communication: true, diplomacy: true },
};

describe('scenario contracts', () => {
  it('centralizes temporary limits', () => {
    expect(WORLD_SCENARIO_LIMITS).toMatchObject({
      minimumAgents: 1,
      maximumAgents: 32,
      minimumResolution: 8,
      maximumResolution: 11,
      maximumGeneratedCells: 5000,
      maximumRadius: 40,
      maximumAllianceMembers: 8,
    });
  });

  it('runtime-validates request, preview and applied contracts', () => {
    const parsed = worldSetupRequestSchema.parse(request);
    const scenario = {
      ...parsed,
      exactCellCount: 1,
      areaSquareKilometers: 0.1,
      startingCells: ['8928308280fffff'],
      setupWarnings: [],
    };
    const preview = worldSetupPreviewResponseSchema.parse({
      feasible: true,
      scenario,
      world: {
        generatedAt: '2026-08-15T00:00:00.000Z',
        hexes: [
          { cell: '8928308280fffff', state: 'open', controllerAgentId: null },
        ],
        agents: [{ ...parsed.roster[0], currentCell: '8928308280fffff' }],
        events: [],
        alliances: [],
        pendingAllianceProposals: [],
      },
    });
    expect(preview.feasible).toBe(true);
    if (preview.feasible)
      expect(
        appliedScenarioSchema.parse(preview.scenario).objectiveVersion,
      ).toBe('durable-influence-v2');
  });

  it('rejects dynamic roster overflow and behavior under-coverage', () => {
    expect(
      worldSetupRequestSchema.safeParse({
        ...request,
        roster: Array.from({ length: 33 }, (_, index) => ({
          ...roster[0],
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: `Agent ${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      behaviorConfigurationSchema.safeParse({
        ...request.behaviorConfiguration,
        assignments: [],
      }).success,
    ).toBe(false);
  });

  it('defaults legacy scenarios to disabled Patient Zero and validates designation', () => {
    expect(
      worldSetupRequestSchema.parse(request).patientZeroAgentId,
    ).toBeNull();
    expect(
      worldSetupRequestSchema.parse({
        ...request,
        patientZeroAgentId: roster[0].id,
      }).patientZeroAgentId,
    ).toBe(roster[0].id);
    expect(
      worldSetupRequestSchema.safeParse({
        ...request,
        patientZeroAgentId: '2507bb46-7ae4-45ca-8dda-644c4f85ca14',
      }).success,
    ).toBe(false);
  });
});
