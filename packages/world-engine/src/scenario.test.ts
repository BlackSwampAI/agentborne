import { describe, expect, it } from 'vitest';
import { assignBehavior, WORLD_RADIUS_PRESETS } from '@hexzero/shared';
import {
  DEVELOPMENT_AGENT_BLUEPRINTS,
  allocateDeterministicSpawns,
  defaultWorldSetupRequest,
  generateDeterministicRoster,
  previewWorldSetup,
} from './index';

describe('configurable world scenarios', () => {
  it('preserves the exact default world and stable starts', () => {
    const first = previewWorldSetup(
      defaultWorldSetupRequest(),
      '2026-08-13T12:00:00.000Z',
    );
    const second = previewWorldSetup(
      defaultWorldSetupRequest(),
      '2026-08-13T12:00:00.000Z',
    );
    expect(first).toEqual(second);
    expect(first.feasible && first.scenario.exactCellCount).toBe(127);
    expect(
      first.feasible &&
        first.world.agents.map(({ id, currentCell }) => ({ id, currentCell })),
    ).toEqual(
      second.feasible &&
        second.world.agents.map(({ id, currentCell }) => ({ id, currentCell })),
    );
  });

  it.each(Object.entries(WORLD_RADIUS_PRESETS))(
    'previews radius preset %s from actual H3 cells',
    (_name, preset) => {
      const request = { ...defaultWorldSetupRequest(), radius: preset.radius };
      const result = previewWorldSetup(request);
      expect(result.feasible).toBe(true);
      if (result.feasible)
        expect(result.scenario.exactCellCount).toBe(preset.expectedCellCount);
    },
  );

  it.each([8, 9, 10, 11])(
    'calculates positive geometry area at resolution %s',
    (resolution) => {
      const result = previewWorldSetup({
        ...defaultWorldSetupRequest(),
        resolution,
      });
      expect(
        result.feasible && result.scenario.areaSquareKilometers,
      ).toBeGreaterThan(0);
    },
  );

  it('generates stable UUID-compatible unique rosters without ambient randomness', () => {
    const first = generateDeterministicRoster(32, 'roster-a');
    expect(first).toEqual(generateDeterministicRoster(32, 'roster-a'));
    expect(new Set(first.map(({ id }) => id)).size).toBe(32);
    expect(
      new Set(first.map(({ name }) => name.toLocaleLowerCase())).size,
    ).toBe(32);
  });

  it('uses the spawn seed, preserves uniqueness and rejects impossible separation', () => {
    const base = previewWorldSetup(defaultWorldSetupRequest());
    expect(base.feasible).toBe(true);
    if (!base.feasible) return;
    const a = allocateDeterministicSpawns(
      base.world.hexes.map(({ cell }) => cell),
      12,
      1,
      'a',
    );
    const b = allocateDeterministicSpawns(
      base.world.hexes.map(({ cell }) => cell),
      12,
      1,
      'b',
    );
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBe(12);
    expect(
      allocateDeterministicSpawns(
        base.world.hexes.map(({ cell }) => cell),
        32,
        40,
        'no-fit',
      ),
    ).toBeNull();
  });

  it('supports a non-default dynamic roster with exact behavior coverage', () => {
    const roster = generateDeterministicRoster(12, 'twelve');
    const request = defaultWorldSetupRequest();
    const result = previewWorldSetup({
      ...request,
      radius: 12,
      roster,
      behaviorConfiguration: {
        ...request.behaviorConfiguration,
        assignments: assignBehavior(
          roster.map(({ id }) => id),
          request.behaviorConfiguration.seed,
          'balanced-random',
        ),
      },
    });
    expect(result.feasible && result.world.agents).toHaveLength(12);
    expect(DEVELOPMENT_AGENT_BLUEPRINTS).toHaveLength(8);
  });
});
