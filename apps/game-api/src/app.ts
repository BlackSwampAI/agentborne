import { Hono } from 'hono';
import { apiErrorSchema, worldSnapshotSchema } from '@agentborne/shared';
import { createDevelopmentWorld } from '@agentborne/world-engine';

export const healthResponseSchema = worldSnapshotSchema
  .pick({ generatedAt: true })
  .transform(({ generatedAt }) => ({
    status: 'ok' as const,
    checkedAt: generatedAt,
  }));

export function createApp() {
  const app = new Hono();

  app.get('/health', (context) => {
    const payload = healthResponseSchema.parse({
      generatedAt: new Date().toISOString(),
    });
    return context.json(payload);
  });

  app.get('/api/development-world', (context) => {
    const payload = worldSnapshotSchema.parse(createDevelopmentWorld());
    return context.json(payload);
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
    console.error('Unhandled API error', error);
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
