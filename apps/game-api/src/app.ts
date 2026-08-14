import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import {
  BrowserTestAgentProvider,
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterAgentProvider,
  type AgentProvider,
} from '@agentborne/agent-runtime';
import {
  apiErrorSchema,
  experimentExportRequestSchema,
  experimentExportPreviewSchema,
  experimentExportResponseSchema,
  PERSONALITY_MAX_LENGTH,
  resetSimulationResponseSchema,
  restoreDefaultPersonalitiesResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
  updateAgentPersonalityRequestSchema,
  updateAgentPersonalityResponseSchema,
  worldSnapshotSchema,
} from '@agentborne/shared';
import { createDevelopmentWorld } from '@agentborne/world-engine';
import {
  SimulationConflictError,
  SimulationService,
  SimulationValidationError,
} from './simulation-service';
import { ExperimentExportValidationError } from './experiment-export';

export const healthResponseSchema = worldSnapshotSchema
  .pick({ generatedAt: true })
  .transform(({ generatedAt }) => ({
    status: 'ok' as const,
    checkedAt: generatedAt,
  }));

export interface AppOptions {
  service?: SimulationService;
  provider?: AgentProvider;
}

export function providerFromEnvironment(): AgentProvider {
  if (process.env.AGENTBORNE_PROVIDER === 'scripted') {
    return new BrowserTestAgentProvider();
  }
  return new OpenRouterAgentProvider({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.AGENTBORNE_MODEL ?? DEFAULT_OPENROUTER_MODEL,
  });
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  const service =
    options.service ??
    new SimulationService({
      provider: options.provider ?? providerFromEnvironment(),
    });

  app.use(
    '/api/*',
    cors({
      origin: (origin) =>
        ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)
          ? origin
          : null,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type'],
    }),
  );

  app.get('/health', (context) =>
    context.json(
      healthResponseSchema.parse({ generatedAt: new Date().toISOString() }),
    ),
  );

  app.get('/api/development-world', (context) =>
    context.json(worldSnapshotSchema.parse(createDevelopmentWorld())),
  );

  app.get('/api/simulation', (context) =>
    context.json(simulationSnapshotSchema.parse(service.getSnapshot())),
  );

  app.post('/api/simulation/turn', async (context) => {
    try {
      const turn = await service.executeNextTurn();
      return context.json(
        singleTurnResponseSchema.parse({
          snapshot: service.getSnapshot(),
          turn,
        }),
      );
    } catch (error) {
      if (error instanceof SimulationConflictError) {
        return context.json(
          apiErrorSchema.parse({
            error: { code: 'turn_conflict', message: error.message },
          }),
          409,
        );
      }
      throw error;
    }
  });

  app.post('/api/simulation/reset', (context) => {
    try {
      return context.json(
        resetSimulationResponseSchema.parse({ snapshot: service.reset() }),
      );
    } catch (error) {
      if (error instanceof SimulationConflictError) {
        return context.json(
          apiErrorSchema.parse({
            error: { code: 'reset_conflict', message: error.message },
          }),
          409,
        );
      }
      throw error;
    }
  });

  app.post('/api/simulation/agents/:agentId/personality', async (context) => {
    const request = updateAgentPersonalityRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!request.success) {
      return context.json(
        apiErrorSchema.parse({
          error: {
            code: 'invalid_personality',
            message: `Personality must contain 1 to ${PERSONALITY_MAX_LENGTH} characters.`,
          },
        }),
        400,
      );
    }
    try {
      const agent = service.updateAgentPersonality(
        context.req.param('agentId'),
        request.data.personality,
      );
      return context.json(
        updateAgentPersonalityResponseSchema.parse({
          snapshot: service.getSnapshot(),
          agent,
        }),
      );
    } catch (error) {
      if (error instanceof SimulationConflictError) {
        return context.json(
          apiErrorSchema.parse({
            error: { code: 'personality_conflict', message: error.message },
          }),
          409,
        );
      }
      if (error instanceof SimulationValidationError) {
        return context.json(
          apiErrorSchema.parse({
            error: { code: error.code, message: error.message },
          }),
          error.code === 'unknown_agent' ? 404 : 400,
        );
      }
      throw error;
    }
  });

  app.post('/api/simulation/personalities/restore-defaults', (context) => {
    try {
      return context.json(
        restoreDefaultPersonalitiesResponseSchema.parse({
          snapshot: service.restoreDefaultPersonalities(),
        }),
      );
    } catch (error) {
      if (error instanceof SimulationConflictError) {
        return context.json(
          apiErrorSchema.parse({
            error: { code: 'personality_conflict', message: error.message },
          }),
          409,
        );
      }
      throw error;
    }
  });

  app.post('/api/simulation/experiment/export/preview', async (context) => {
    const request = experimentExportRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!request.success)
      return context.json(
        apiErrorSchema.parse({
          error: {
            code: 'invalid_export',
            message: 'The export filters are invalid.',
          },
        }),
        400,
      );
    try {
      return context.json(
        experimentExportPreviewSchema.parse(
          service.previewExperimentExport(request.data),
        ),
      );
    } catch (error) {
      return exportErrorResponse(context, error);
    }
  });

  app.post('/api/simulation/experiment/export', async (context) => {
    const request = experimentExportRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!request.success)
      return context.json(
        apiErrorSchema.parse({
          error: {
            code: 'invalid_export',
            message: 'The export filters are invalid.',
          },
        }),
        400,
      );
    try {
      return context.json(
        experimentExportResponseSchema.parse({
          document: service.generateExperimentExport(request.data),
        }),
      );
    } catch (error) {
      return exportErrorResponse(context, error);
    }
  });

  app.notFound((context) =>
    context.json(
      apiErrorSchema.parse({
        error: {
          code: 'not_found',
          message: 'The requested route does not exist.',
        },
      }),
      404,
    ),
  );

  app.onError((error, context) => {
    console.error(
      'Unhandled API error',
      error instanceof Error ? error.name : 'unknown',
    );
    return context.json(
      apiErrorSchema.parse({
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred.',
        },
      }),
      500,
    );
  });

  return app;
}

export type GameApi = ReturnType<typeof createApp>;

function exportErrorResponse(context: Context, error: unknown) {
  if (error instanceof SimulationConflictError)
    return context.json(
      apiErrorSchema.parse({
        error: { code: 'export_conflict', message: error.message },
      }),
      409,
    );
  if (error instanceof ExperimentExportValidationError)
    return context.json(
      apiErrorSchema.parse({
        error: { code: error.code, message: error.message },
      }),
      error.code === 'unknown_agent' ? 404 : 400,
    );
  throw error;
}
