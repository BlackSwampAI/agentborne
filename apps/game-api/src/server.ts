import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({ fetch: createApp().fetch, port }, ({ port: listeningPort }) => {
  console.log(`Game API listening on http://localhost:${listeningPort}`);
});
