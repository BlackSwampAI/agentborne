import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gridDisk } from 'h3-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  simulationSnapshotSchema,
  type SimulationSnapshot,
} from '@agentborne/shared';
import { createDevelopmentWorld } from '@agentborne/world-engine';
import { WorldLab } from './world-lab';

const mapLibreMock = vi.hoisted(() => ({
  renderMode: 'complete' as 'complete' | 'incomplete',
  rejectSource: false,
  rejectLayers: false,
  duplicateFeatures: false,
  autoRender: true,
  pendingRenderCallbacks: [] as Array<() => void>,
  mapClick: undefined as
    | ((event: { features: Array<{ properties: { cell: string } }> }) => void)
    | undefined,
  layers: [] as Array<{
    id: string;
    paint?: Record<string, unknown>;
  }>,
  queryRenderedFeatures: vi.fn(),
  setData: vi.fn(),
}));

vi.mock('maplibre-gl', () => {
  class Map {
    source:
      | {
          data: {
            features: Array<{
              properties: { cell: string; state: string; selected: boolean };
            }>;
          };
          setData: (data: unknown) => void;
        }
      | undefined;
    sourceLoaded = false;
    layers = new Set<string>();
    listeners = new globalThis.Map<string, Set<(event?: unknown) => void>>();
    addControl() {}
    addLayer(layer: { id: string; paint?: Record<string, unknown> }) {
      mapLibreMock.layers.push(layer);
      if (!mapLibreMock.rejectLayers) this.layers.add(layer.id);
    }
    addSource(
      id: string,
      source: {
        data: {
          features: Array<{
            properties: { cell: string; state: string; selected: boolean };
          }>;
        };
      },
    ) {
      if (mapLibreMock.rejectSource) return;
      const completeSourceUpdate = () => {
        this.sourceLoaded = true;
        this.emit('sourcedata', { sourceId: id, isSourceLoaded: true });
      };
      this.source = {
        data: source.data,
        setData: (data) => {
          mapLibreMock.setData(data);
          this.source!.data = data as typeof source.data;
          this.sourceLoaded = false;
          queueMicrotask(completeSourceUpdate);
        },
      };
      queueMicrotask(completeSourceUpdate);
    }
    emit(event: string, eventData?: unknown) {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener(eventData);
      }
    }
    fitBounds() {}
    getCanvas() {
      return { style: { cursor: '' } };
    }
    getLayer(id: string) {
      return this.layers.has(id) ? { id } : undefined;
    }
    getSource() {
      return this.source;
    }
    isSourceLoaded() {
      return Boolean(this.source) && this.sourceLoaded;
    }
    queryRenderedFeatures(options: { layers: string[] }) {
      mapLibreMock.queryRenderedFeatures(options);
      if (!this.source || !this.layers.has('development-hex-fills')) return [];
      const features =
        mapLibreMock.renderMode === 'incomplete'
          ? this.source.data.features.slice(0, -1)
          : [...this.source.data.features];
      return mapLibreMock.duplicateFeatures && features[0]
        ? [...features, features[0], features[0]]
        : features;
    }
    on(
      event: string,
      layerOrCallback: unknown,
      callback?: (event: {
        features: Array<{ properties: { cell: string } }>;
      }) => void,
    ) {
      if (event === 'load' && typeof layerOrCallback === 'function') {
        queueMicrotask(() => layerOrCallback());
      }
      if (event === 'click' && typeof callback === 'function') {
        mapLibreMock.mapClick = callback;
      } else if (event !== 'load' && typeof layerOrCallback === 'function') {
        const listeners =
          this.listeners.get(event) ?? new Set<(event?: unknown) => void>();
        listeners.add(layerOrCallback as (event?: unknown) => void);
        this.listeners.set(event, listeners);
      }
    }
    off(event: string, layerOrCallback: unknown, callback?: () => void) {
      if (typeof layerOrCallback === 'function') {
        this.listeners.get(event)?.delete(layerOrCallback as () => void);
      }
      if (event === 'click' && callback) mapLibreMock.mapClick = undefined;
    }
    triggerRepaint() {
      const completeRender = () => this.emit('render');
      if (mapLibreMock.autoRender) queueMicrotask(completeRender);
      else mapLibreMock.pendingRenderCallbacks.push(completeRender);
    }
    remove() {}
  }
  class Marker {
    constructor(private options: { element: HTMLElement }) {}
    setLngLat() {
      return this;
    }
    addTo() {
      document.body.append(this.options.element);
      return this;
    }
    remove() {
      this.options.element.remove();
    }
  }
  return {
    setWorkerUrl: vi.fn(),
    Map,
    Marker,
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
    NavigationControl: class {},
    AttributionControl: class {},
  };
});

const world = createDevelopmentWorld({
  generatedAt: '2026-08-13T12:00:00.000Z',
});
const initial = simulationSnapshotSchema.parse({
  world,
  turnNumber: 0,
  nextAgentId: world.agents[0]!.id,
  activeAgentId: null,
  status: 'paused',
  providerMode: 'scripted-test',
  providerConfigured: true,
  turns: [],
});

function afterInfection(): SimulationSnapshot {
  const agent = world.agents[0]!;
  const event = {
    id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
    agentId: agent.id,
    occurredAt: '2026-08-13T12:00:01.000Z',
    type: 'hex-infected' as const,
    cell: agent.currentCell,
  };
  const adjacent = gridDisk(agent.currentCell, 1).find(
    (cell) =>
      cell !== agent.currentCell &&
      world.hexes.some((hex) => hex.cell === cell),
  )!;
  const turn = {
    turnNumber: 1,
    agentId: agent.id,
    startedAt: '2026-08-13T12:00:00.000Z',
    completedAt: '2026-08-13T12:00:01.000Z',
    observation: {
      agentId: agent.id,
      agentName: agent.name,
      personality: agent.personality,
      currentCell: { cell: agent.currentCell, state: 'open' as const },
      adjacentCells: [{ cell: adjacent, state: 'open' as const }],
      nearbyAgents: [],
      recentEvents: [],
    },
    outcome: 'accepted' as const,
    requestedAction: { type: 'infect' as const },
    summary: 'Infecting this open cell.',
    validation: { accepted: true as const },
    event,
    provider: {
      provider: 'scripted-test' as const,
      model: 'test',
      latencyMs: 0,
    },
  };
  return simulationSnapshotSchema.parse({
    ...initial,
    world: {
      ...world,
      hexes: world.hexes.map((hex) =>
        hex.cell === agent.currentCell
          ? { ...hex, state: 'infected' as const }
          : hex,
      ),
      events: [event],
    },
    turnNumber: 1,
    nextAgentId: world.agents[1]!.id,
    turns: [turn],
  });
}

function jsonResponse(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
}

beforeEach(() => {
  mapLibreMock.renderMode = 'complete';
  mapLibreMock.rejectSource = false;
  mapLibreMock.rejectLayers = false;
  mapLibreMock.duplicateFeatures = false;
  mapLibreMock.autoRender = true;
  mapLibreMock.pendingRenderCallbacks = [];
  mapLibreMock.mapClick = undefined;
  mapLibreMock.layers = [];
  mapLibreMock.queryRenderedFeatures.mockReset();
  mapLibreMock.setData.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => jsonResponse(initial)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorldLab', () => {
  it('renders all controls, status, H3 readiness, and six visible markers', async () => {
    render(<WorldLab />);
    expect(
      await screen.findByText(
        /H3 overlay ready · 61\/61 rendered cells · 6 agents/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('world-map')).toHaveAttribute(
      'data-rendered-h3-cell-count',
      '61',
    );
    expect(mapLibreMock.queryRenderedFeatures).toHaveBeenCalledWith({
      layers: ['development-hex-fills'],
    });
    expect(
      screen.getByRole('heading', { name: 'World Lab' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Single turn' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    expect(screen.getByLabelText('Playback speed')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /Select agent/ }),
    ).toHaveLength(6);
    expect(screen.getByText('Automated-test provider')).toBeInTheDocument();
  });

  it('deduplicates rendered H3 features before reporting readiness', async () => {
    mapLibreMock.duplicateFeatures = true;
    render(<WorldLab />);
    expect(
      await screen.findByText(/H3 overlay ready · 61\/61 rendered cells/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('world-map')).toHaveAttribute(
      'data-rendered-h3-cell-count',
      '61',
    );
  });

  it('waits for an H3 source update and render cycle before inspecting readiness', async () => {
    mapLibreMock.autoRender = false;
    render(<WorldLab />);
    await screen.findByRole('button', { name: 'Select agent Ember' });
    expect(screen.getByText(/H3 overlay initializing/)).toBeInTheDocument();
    expect(mapLibreMock.queryRenderedFeatures).not.toHaveBeenCalled();

    act(() => {
      const pendingRenders = mapLibreMock.pendingRenderCallbacks.splice(0);
      for (const completeRender of pendingRenders) {
        completeRender();
      }
    });

    expect(
      await screen.findByText(/H3 overlay ready · 61\/61 rendered cells/),
    ).toBeInTheDocument();
  });

  it.each([
    {
      scenario: 'incomplete rendering',
      configure: () => (mapLibreMock.renderMode = 'incomplete'),
      expectedStatus: 'incomplete',
      expectedCount: '60',
    },
    {
      scenario: 'rejected layers',
      configure: () => (mapLibreMock.rejectLayers = true),
      expectedStatus: 'failed',
      expectedCount: '0',
    },
  ])(
    'does not report readiness for $scenario',
    async ({ configure, expectedCount, expectedStatus }) => {
      configure();
      render(<WorldLab />);
      expect(
        await screen.findByText(/H3 overlay (?:incomplete|failed)/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/H3 overlay ready/)).not.toBeInTheDocument();
      expect(screen.getByTestId('world-map')).not.toHaveAttribute(
        'data-overlay-status',
        'ready',
      );
      expect(screen.getByTestId('world-map')).toHaveAttribute(
        'data-overlay-status',
        expectedStatus,
      );
      expect(screen.getByTestId('world-map')).toHaveAttribute(
        'data-rendered-h3-cell-count',
        expectedCount,
      );
    },
  );

  it('uses explicit boolean assertions in every conditional paint expression', async () => {
    render(<WorldLab />);
    await screen.findByText(/H3 overlay ready/);
    const conditions = mapLibreMock.layers.flatMap(({ paint = {} }) =>
      Object.values(paint)
        .filter(
          (expression): expression is unknown[] =>
            Array.isArray(expression) && expression[0] === 'case',
        )
        .map((expression) => expression[1]),
    );
    expect(conditions).toHaveLength(3);
    expect(conditions).toEqual(
      Array(3).fill(['boolean', ['get', 'selected'], false]),
    );
  });

  it('selects an agent and populates its inspector', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(
      await screen.findByRole('button', { name: 'Select agent Rook' }),
    );
    expect(screen.getByRole('heading', { name: /Rook/ })).toBeInTheDocument();
    expect(screen.getByText(world.agents[1]!.personality)).toBeInTheDocument();
    expect(screen.getByText(world.agents[1]!.id)).toBeInTheDocument();
  });

  it('executes one turn and renders infection and decision details safely', async () => {
    const changed = afterInfection();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => jsonResponse(initial))
        .mockImplementationOnce(() =>
          jsonResponse({ snapshot: changed, turn: changed.turns[0] }),
        ),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(
      await screen.findByRole('button', { name: 'Single turn' }),
    );
    expect(
      await screen.findByText('Infection · ' + world.agents[0]!.currentCell),
    ).toBeInTheDocument();
    expect(screen.getByText('Infecting this open cell.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('world-map')).toHaveAttribute(
        'data-rendered-infected-cell-count',
        '1',
      ),
    );
    expect(screen.getByTestId('infected-count')).toHaveTextContent(
      '1 rendered infected',
    );
    expect(mapLibreMock.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({ state: 'infected' }),
          }),
        ]),
      }),
    );
    expect(screen.queryByText(/chain-of-thought/i)).not.toBeInTheDocument();
  });

  it('starts, pauses, and changes playback speed without overlapping immediately', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Playback speed'), '250');
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('resets turn history and UI selections', async () => {
    const changed = afterInfection();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => jsonResponse(changed))
        .mockImplementationOnce(() => jsonResponse({ snapshot: initial })),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    await waitFor(() =>
      expect(screen.getByTestId('world-map')).toHaveAttribute(
        'data-rendered-infected-cell-count',
        '1',
      ),
    );
    expect(
      await screen.findByText('Infection · ' + world.agents[0]!.currentCell),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(
        screen.getByText('Development world loaded with six agents.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Turn 0')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('world-map')).toHaveAttribute(
        'data-rendered-infected-cell-count',
        '0',
      ),
    );
  });

  it('supports hex selection independently of agent selection', async () => {
    render(<WorldLab />);
    await screen.findByRole('button', { name: 'Select agent Ember' });
    const target = world.hexes[1]!.cell;
    act(() =>
      mapLibreMock.mapClick?.({
        features: [{ properties: { cell: target } }],
      }),
    );
    expect(screen.getByText(target)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Ember/ })).toBeInTheDocument();
  });

  it('renders missing configuration without enabling cost-incurring controls', async () => {
    const unconfigured = simulationSnapshotSchema.parse({
      ...initial,
      status: 'configuration-error',
      providerMode: 'openrouter',
      providerConfigured: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(unconfigured)),
    );
    render(<WorldLab />);
    expect(
      await screen.findByText(/Model calls unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Single turn' })).toBeDisabled();
  });
});
