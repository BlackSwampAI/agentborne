import { latLngToCell, gridDisk } from 'h3-js';
import {
  agentIdSchema,
  agentObservationSchema,
  h3CellSchema,
} from '@agentborne/shared';
import { OpenRouterAgentProvider } from './index';

const currentCell = h3CellSchema.parse(latLngToCell(41.6528, -83.5379, 9));
const adjacentCells = gridDisk(currentCell, 1)
  .filter((cell) => cell !== currentCell)
  .map((cell) => ({ cell: h3CellSchema.parse(cell), state: 'open' as const }));

const provider = new OpenRouterAgentProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.AGENTBORNE_MODEL,
});
const observation = agentObservationSchema.parse({
  agentId: agentIdSchema.parse('128f3f38-6b7d-4db7-9e95-751b4ce2681e'),
  agentName: 'Ember',
  personality: 'Prefer infecting open cells and moving into uninfected space.',
  currentCell: { cell: currentCell, state: 'open' },
  adjacentCells,
  nearbyAgents: [],
  recentEvents: [],
});

const result = await provider.decide(observation);
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
