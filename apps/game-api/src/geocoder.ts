import {
  locationSearchResponseSchema,
  type LocationSearchResponse,
} from '@agentborne/shared';

export interface Geocoder {
  search(query: string): Promise<LocationSearchResponse>;
}

export class NominatimGeocoder implements Geocoder {
  readonly #baseUrl: string;
  readonly #cache = new Map<string, LocationSearchResponse>();
  #lastRequestAt = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    baseUrl = process.env.NOMINATIM_BASE_URL ??
      'https://nominatim.openstreetmap.org',
  ) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  async search(query: string): Promise<LocationSearchResponse> {
    const normalized = query.trim().slice(0, 120);
    const cached = this.#cache.get(normalized.toLocaleLowerCase());
    if (cached) return structuredClone(cached);
    const predecessor = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    const wait = Math.max(0, 1_000 - (Date.now() - this.#lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    this.#lastRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const url = new URL('/search', this.#baseUrl);
      url.searchParams.set('q', normalized);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Agentborne-WorldLab (+https://github.com/BlackSwampAI/agentborne)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('geocoder response');
      const body = (await response.json()) as Array<{
        display_name?: unknown;
        lat?: unknown;
        lon?: unknown;
      }>;
      const result = locationSearchResponseSchema.parse({
        results: body.slice(0, 5).flatMap((entry) => {
          const latitude = Number(entry.lat);
          const longitude = Number(entry.lon);
          return typeof entry.display_name === 'string' &&
            Number.isFinite(latitude) &&
            Number.isFinite(longitude)
            ? [{ label: entry.display_name.slice(0, 240), latitude, longitude }]
            : [];
        }),
        attribution: '© OpenStreetMap contributors',
      });
      this.#cache.set(normalized.toLocaleLowerCase(), result);
      if (this.#cache.size > 100)
        this.#cache.delete(this.#cache.keys().next().value!);
      return structuredClone(result);
    } catch {
      return locationSearchResponseSchema.parse({
        results: [],
        attribution: '© OpenStreetMap contributors',
        warning: {
          code: 'geocoder-unavailable',
          message:
            'Location search is temporarily unavailable; enter coordinates manually.',
        },
      });
    } finally {
      clearTimeout(timeout);
      release();
    }
  }
}
