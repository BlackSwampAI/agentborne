import { describe, expect, it } from 'vitest';
import { worldSnapshotSchema } from '@agentborne/shared';
import { createApp } from './app';

describe('game API', () => {
  const app = createApp();

  it('reports health with a typed response', async () => {
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('serves a schema-valid development world', async () => {
    const response = await app.request('/api/development-world');
    expect(response.status).toBe(200);
    const payload = worldSnapshotSchema.parse(await response.json());
    expect(payload.hexes.length).toBeGreaterThan(6);
    expect(payload.hexes.some((hex) => hex.state === 'infected')).toBe(true);
  });

  it('uses a predictable error envelope', async () => {
    const response = await app.request('/missing');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'The requested route does not exist.',
      },
    });
  });
});
