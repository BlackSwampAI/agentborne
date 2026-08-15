import { describe, expect, it } from 'vitest';
import { DARK_TILE_ATTRIBUTION, DARK_TILE_URLS } from './map-config';

describe('dark basemap configuration', () => {
  it('uses tokenless CARTO Dark Matter tiles with complete attribution', () => {
    expect(DARK_TILE_URLS).toHaveLength(3);
    expect(DARK_TILE_URLS.every((url) => url.includes('/dark_all/'))).toBe(
      true,
    );
    expect(DARK_TILE_URLS.every((url) => !url.includes('token'))).toBe(true);
    expect(DARK_TILE_ATTRIBUTION).toContain('OpenStreetMap');
    expect(DARK_TILE_ATTRIBUTION).toContain('CARTO');
  });
});
