import { readFileSync } from 'node:fs';
import { latLngToCell, gridDisk } from 'h3-js';
import {
  agentIdSchema,
  agentObservationSchema,
  h3CellSchema,
} from '@hexzero/shared';
import {
  AgentProviderError,
  OpenRouterAgentProvider,
  applyProviderEnvironmentFile,
} from './index';

try {
  applyProviderEnvironmentFile(
    readFileSync(new URL('../../../.env', import.meta.url), 'utf8'),
  );
} catch (error) {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== 'ENOENT'
  ) {
    throw error;
  }
}

const currentCell = h3CellSchema.parse(latLngToCell(41.6528, -83.5379, 9));
const adjacentCells = gridDisk(currentCell, 1)
  .filter((cell) => cell !== currentCell)
  .map((cell) => ({
    cell: h3CellSchema.parse(cell),
    state: 'open' as const,
    controllerAgentId: null,
  }));

const provider = new OpenRouterAgentProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
});
const selectedModel = process.argv[2]?.trim();
if (!selectedModel)
  throw new Error(
    'Pass an explicit compatible model slug to smoke:openrouter.',
  );
const observation = agentObservationSchema.parse({
  agentId: agentIdSchema.parse('128f3f38-6b7d-4db7-9e95-751b4ce2681e'),
  agentName: 'Ember',
  personality: 'Prefer infecting open cells and moving into uninfected space.',
  currentCell: { cell: currentCell, state: 'open', controllerAgentId: null },
  captureEligibility: {
    eligible: false,
    blockedReason: 'capture-open-cell',
  },
  actionAvailability: {
    moveTargetCellIds: adjacentCells.map(({ cell }) => cell),
    infect: { available: true },
    capture: { available: false, reason: 'capture-open-cell' },
    wait: { available: true },
  },
  adjacentCells,
  nearbyAgents: [],
  recentEvents: [],
  recentPublicMessages: [],
  recentDirectMessages: [],
  territoryScoreboard: [
    ['128f3f38-6b7d-4db7-9e95-751b4ce2681e', 'Ember', '#ff6b57'],
    ['2507bb46-7ae4-45ca-8dda-644c4f85ca14', 'Rook', '#ffd166'],
    ['3ba3ef0b-2142-44cc-b175-f6e5d6e98df5', 'Mingle', '#63d2ff'],
    ['442a1667-39c8-48e9-8c89-23803f9e2101', 'Solace', '#c59cff'],
    ['5f812a08-05f2-4950-bf2d-4df59d05e9c2', 'Verge', '#6ee7a8'],
    ['67a43b5c-ced8-45bd-970f-a89ac57853fc', 'Jinx', '#ff91c8'],
  ].map(([agentId, name, color]) => ({
    agentId,
    name,
    color,
    controlledCellCount: 0,
  })),
  recentControlChanges: [],
});

try {
  const result = await provider.decide(observation, selectedModel);
  console.log(
    JSON.stringify(
      {
        valid: true,
        decision: result.decision,
        provider: result.metadata.provider,
        model: result.metadata.model,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (!(error instanceof AgentProviderError)) throw error;
  console.error(
    JSON.stringify(
      {
        valid: false,
        failure: error.failure,
        diagnostics: error.diagnostics,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
