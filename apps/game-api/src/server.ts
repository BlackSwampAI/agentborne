import { serve } from '@hono/node-server';
import { createApp } from './app';

try {
  process.loadEnvFile('../../.env.local');
} catch (error) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code !== 'ENOENT') throw error;
}

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({
  fetch: createApp().fetch,
  hostname: '127.0.0.1',
  port,
}, ({ port: listeningPort }) => {
  console.log(`Game API listening on http://localhost:${listeningPort}`);
});
