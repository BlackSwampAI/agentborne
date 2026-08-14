import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gridDisk } from 'h3-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  experimentExportDocumentSchema,
  simulationSnapshotSchema,
  type SimulationSnapshot,
} from '@agentborne/shared';
import { createDevelopmentWorld } from '@agentborne/world-engine';
import { WorldLab } from './world-lab';
import { PERSONALITY_PRESETS } from './personality-presets';

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
  latestSourceData: undefined as unknown,
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
          mapLibreMock.latestSourceData = data;
          this.source!.data = data as typeof source.data;
          this.sourceLoaded = false;
          queueMicrotask(completeSourceUpdate);
        },
      };
      mapLibreMock.latestSourceData = source.data;
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
const HOSTILE_MESSAGE = '<img src=x onerror=alert(1)> Hold position.';
const emptyTerritory = world.agents.map(({ id, name, color }) => ({
  agentId: id,
  name,
  color,
  controlledCellCount: 0,
}));
const initial = simulationSnapshotSchema.parse({
  world,
  turnNumber: 0,
  nextAgentId: world.agents[0]!.id,
  activeAgentId: null,
  status: 'paused',
  providerMode: 'scripted-test',
  providerConfigured: true,
  turns: [],
  experiment: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    startedAt: '2026-08-13T12:00:00.000Z',
    totalCompletedTurns: 0,
    retainedTurns: 0,
    droppedRecords: 0,
    complete: true,
    metrics: {
      aggregate: emptyMetrics(),
      byAgent: world.agents.map(({ id }) => ({
        agentId: id,
        metrics: emptyMetrics(),
      })),
    },
    currentTerritory: emptyTerritory,
  },
});

function emptyMetrics() {
  return {
    totalTurns: 0,
    accepted: 0,
    rejected: 0,
    providerErrors: 0,
    requestedMoves: 0,
    requestedInfections: 0,
    requestedCaptures: 0,
    requestedMessages: 0,
    requestedWaits: 0,
    acceptedMovements: 0,
    successfullyInfectedCells: 0,
    successfulCaptures: 0,
    territoryGainedThroughInfection: 0,
    territoryGainedThroughCapture: 0,
    territoryLostThroughCapture: 0,
    deliveredMessages: 0,
    sentCommunications: 0,
    receivedCommunications: 0,
    uniqueVisitedCells: 0,
    tokens: {},
    knownCostCredits: 0,
    turnsWithUnknownCost: 0,
  };
}

function afterInfection(): SimulationSnapshot {
  const agent = world.agents[0]!;
  const event = {
    id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
    agentId: agent.id,
    occurredAt: '2026-08-13T12:00:01.000Z',
    type: 'hex-infected' as const,
    cell: agent.currentCell,
    controllerAgentId: agent.id,
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
      currentCell: {
        cell: agent.currentCell,
        state: 'open' as const,
        controllerAgentId: null,
      },
      captureEligibility: {
        eligible: false as const,
        blockedReason: 'capture-open-cell' as const,
      },
      adjacentCells: [
        { cell: adjacent, state: 'open' as const, controllerAgentId: null },
      ],
      nearbyAgents: [],
      recentEvents: [],
      recentCommunications: [],
      territoryScoreboard: emptyTerritory,
      recentControlChanges: [],
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
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costCredits: 0,
    },
  };
  return simulationSnapshotSchema.parse({
    ...initial,
    world: {
      ...world,
      hexes: world.hexes.map((hex) =>
        hex.cell === agent.currentCell
          ? {
              ...hex,
              state: 'infected' as const,
              controllerAgentId: agent.id,
            }
          : hex,
      ),
      events: [event],
    },
    turnNumber: 1,
    nextAgentId: world.agents[1]!.id,
    turns: [turn],
    experiment: {
      ...initial.experiment,
      totalCompletedTurns: 1,
      retainedTurns: 1,
      firstRetainedTurn: 1,
      lastRetainedTurn: 1,
      metrics: {
        aggregate: {
          ...emptyMetrics(),
          totalTurns: 1,
          accepted: 1,
          requestedInfections: 1,
          successfullyInfectedCells: 1,
          territoryGainedThroughInfection: 1,
          uniqueVisitedCells: 1,
          averageLatencyMs: 0,
        },
        byAgent: initial.experiment.metrics.byAgent.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                metrics: {
                  ...emptyMetrics(),
                  totalTurns: 1,
                  accepted: 1,
                  requestedInfections: 1,
                  successfullyInfectedCells: 1,
                  territoryGainedThroughInfection: 1,
                  uniqueVisitedCells: 1,
                  averageLatencyMs: 0,
                },
              }
            : entry,
        ),
      },
      currentTerritory: emptyTerritory.map((entry, index) => ({
        ...entry,
        controlledCellCount: index === 0 ? 1 : 0,
      })),
    },
  });
}

function afterMessage(): SimulationSnapshot {
  const sender = world.agents[0]!;
  const recipient = world.agents[1]!;
  const message = HOSTILE_MESSAGE;
  const event = {
    id: '67aa21b9-fc78-4b04-9f92-9862bf346f96',
    agentId: sender.id,
    recipientId: recipient.id,
    occurredAt: '2026-08-13T12:00:01.000Z',
    type: 'agent-messaged' as const,
    message,
    distance: 2,
  };
  const turn = {
    turnNumber: 1,
    agentId: sender.id,
    startedAt: '2026-08-13T12:00:00.000Z',
    completedAt: '2026-08-13T12:00:01.000Z',
    observation: {
      agentId: sender.id,
      agentName: sender.name,
      personality: sender.personality,
      currentCell: {
        cell: sender.currentCell,
        state: 'open' as const,
        controllerAgentId: null,
      },
      captureEligibility: {
        eligible: false as const,
        blockedReason: 'capture-open-cell' as const,
      },
      adjacentCells: [
        {
          cell: world.hexes[1]!.cell,
          state: 'open' as const,
          controllerAgentId: null,
        },
      ],
      nearbyAgents: [
        {
          id: recipient.id,
          name: recipient.name,
          currentCell: recipient.currentCell,
          distance: 2,
        },
      ],
      recentEvents: [],
      recentCommunications: [],
      territoryScoreboard: emptyTerritory,
      recentControlChanges: [],
    },
    outcome: 'accepted' as const,
    requestedAction: {
      type: 'message' as const,
      recipientId: recipient.id,
      message,
    },
    summary: 'Sending a nearby message.',
    validation: { accepted: true as const },
    event,
    provider: {
      provider: 'scripted-test' as const,
      model: 'test',
      latencyMs: 0,
      costCredits: 0,
    },
  };
  return simulationSnapshotSchema.parse({
    ...initial,
    world: { ...world, events: [event] },
    turnNumber: 1,
    nextAgentId: recipient.id,
    turns: [turn],
    experiment: {
      ...initial.experiment,
      totalCompletedTurns: 1,
      retainedTurns: 1,
      firstRetainedTurn: 1,
      lastRetainedTurn: 1,
      metrics: {
        aggregate: {
          ...emptyMetrics(),
          totalTurns: 1,
          accepted: 1,
          requestedMessages: 1,
          deliveredMessages: 1,
          sentCommunications: 1,
          receivedCommunications: 1,
          uniqueVisitedCells: 1,
          averageLatencyMs: 0,
        },
        byAgent: initial.experiment.metrics.byAgent.map((entry, index) => ({
          ...entry,
          metrics:
            index === 0
              ? {
                  ...emptyMetrics(),
                  totalTurns: 1,
                  accepted: 1,
                  requestedMessages: 1,
                  deliveredMessages: 1,
                  sentCommunications: 1,
                  uniqueVisitedCells: 1,
                  averageLatencyMs: 0,
                }
              : index === 1
                ? { ...emptyMetrics(), receivedCommunications: 1 }
                : entry.metrics,
        })),
      },
    },
  });
}

function afterCapture(): SimulationSnapshot {
  const infected = afterInfection();
  const previous = world.agents[0]!;
  const capturer = world.agents[1]!;
  const cell = previous.currentCell;
  const controllerDepartureCell = gridDisk(cell, 1).find(
    (candidate) =>
      candidate !== cell && world.hexes.some(({ cell }) => cell === candidate),
  )!;
  const captureEvent = {
    id: '77bb21b9-fc78-4b04-9f92-9862bf346f97',
    agentId: capturer.id,
    occurredAt: '2026-08-13T12:00:02.000Z',
    type: 'hex-captured' as const,
    cell,
    controllerAgentId: capturer.id,
    previousControllerAgentId: previous.id,
  };
  const captureTurn = {
    turnNumber: 2,
    agentId: capturer.id,
    startedAt: '2026-08-13T12:00:01.000Z',
    completedAt: '2026-08-13T12:00:02.000Z',
    observation: {
      agentId: capturer.id,
      agentName: capturer.name,
      personality: capturer.personality,
      currentCell: {
        cell,
        state: 'infected' as const,
        controllerAgentId: previous.id,
      },
      captureEligibility: { eligible: true as const },
      adjacentCells: [
        {
          ...world.hexes[1]!,
        },
      ],
      nearbyAgents: [
        {
          id: previous.id,
          name: previous.name,
          currentCell: controllerDepartureCell,
          distance: 1,
        },
      ],
      recentEvents: [],
      recentCommunications: [],
      territoryScoreboard: emptyTerritory.map((entry, index) => ({
        ...entry,
        controlledCellCount: index === 0 ? 1 : 0,
      })),
      recentControlChanges: [],
    },
    outcome: 'accepted' as const,
    requestedAction: { type: 'capture' as const },
    summary: 'Capturing this contested hex.',
    validation: { accepted: true as const },
    event: captureEvent,
    provider: {
      provider: 'scripted-test' as const,
      model: 'test',
      latencyMs: 0,
      costCredits: 0,
    },
  };
  return simulationSnapshotSchema.parse({
    ...infected,
    world: {
      ...infected.world,
      hexes: infected.world.hexes.map((hex) =>
        hex.cell === cell ? { ...hex, controllerAgentId: capturer.id } : hex,
      ),
      agents: infected.world.agents.map((agent) =>
        agent.id === capturer.id
          ? { ...agent, currentCell: cell }
          : agent.id === previous.id
            ? { ...agent, currentCell: controllerDepartureCell }
            : agent,
      ),
      events: [...infected.world.events, captureEvent],
    },
    turnNumber: 2,
    nextAgentId: world.agents[2]!.id,
    turns: [...infected.turns, captureTurn],
    experiment: {
      ...infected.experiment,
      totalCompletedTurns: 2,
      retainedTurns: 2,
      lastRetainedTurn: 2,
      metrics: {
        aggregate: {
          ...infected.experiment.metrics.aggregate,
          totalTurns: 2,
          accepted: 2,
          requestedCaptures: 1,
          successfulCaptures: 1,
          territoryGainedThroughCapture: 1,
          territoryLostThroughCapture: 1,
        },
        byAgent: infected.experiment.metrics.byAgent.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                metrics: {
                  ...entry.metrics,
                  territoryLostThroughCapture: 1,
                },
              }
            : index === 1
              ? {
                  ...entry,
                  metrics: {
                    ...entry.metrics,
                    totalTurns: 1,
                    accepted: 1,
                    requestedCaptures: 1,
                    successfulCaptures: 1,
                    territoryGainedThroughCapture: 1,
                    uniqueVisitedCells: 1,
                    averageLatencyMs: 0,
                  },
                }
              : entry,
        ),
      },
      currentTerritory: emptyTerritory.map((entry, index) => ({
        ...entry,
        controlledCellCount: index === 1 ? 1 : 0,
      })),
    },
  });
}

function jsonResponse(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
}

function withPersonality(
  snapshot: SimulationSnapshot,
  agentId: string,
  personality: string,
): SimulationSnapshot {
  return simulationSnapshotSchema.parse({
    ...snapshot,
    world: {
      ...snapshot.world,
      agents: snapshot.world.agents.map((agent) =>
        agent.id === agentId ? { ...agent, personality } : agent,
      ),
    },
  });
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
  mapLibreMock.latestSourceData = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => jsonResponse(initial)),
  );
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
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
    expect(screen.getByRole('button', { name: 'Reset world' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Restore default personalities' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Playback speed')).toBeInTheDocument();
    expect(
      await screen.findAllByRole('button', { name: /Select agent/ }),
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
    expect(
      screen.getByText('No communications for this agent yet.'),
    ).toBeInTheDocument();
  });

  it('renders accepted messages, directions, and hostile-looking text as plain text', async () => {
    const changed = afterMessage();
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
      await screen.findByText(/Message · Ember → Rook/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Recent communications')).toHaveTextContent(
      'Outbound Ember → Rook',
    );
    expect(screen.getAllByText(HOSTILE_MESSAGE).length).toBeGreaterThan(0);
    expect(document.querySelector('img[src="x"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Select agent Rook' }));
    expect(screen.getByLabelText('Recent communications')).toHaveTextContent(
      'Inbound Ember → Rook',
    );
  });

  it('clears visible communications after reset', async () => {
    const changed = afterMessage();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => jsonResponse(changed))
        .mockImplementationOnce(() => jsonResponse({ snapshot: initial })),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    expect(
      await screen.findByLabelText('Recent communications'),
    ).toHaveTextContent('Outbound Ember → Rook');
    await user.click(screen.getByRole('button', { name: 'Reset world' }));
    expect(
      await screen.findByText('No communications for this agent yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(HOSTILE_MESSAGE)).not.toBeInTheDocument();
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
    await user.click(screen.getByText('Latest structured observation'));
    expect(
      screen.getByText('Latest structured observation').closest('details'),
    ).toHaveTextContent('Capture: blocked · capture-open-cell');
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

  it('renders controller identity, territory totals, capture events, and both gain/loss views', async () => {
    const user = userEvent.setup();
    const captured = afterCapture();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(captured)),
    );
    render(<WorldLab />);
    expect(
      await screen.findByRole('heading', { name: 'Territory scoreboard' }),
    ).toBeInTheDocument();
    const scoreboard = screen.getByLabelText('Territory scoreboard');
    expect(scoreboard).toHaveTextContent('Ember0');
    expect(scoreboard).toHaveTextContent('Rook1');
    expect(screen.getByText('Rook', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/Rook captured .* from Ember/)).toBeInTheDocument();
    expect(screen.getByLabelText('Recent territory changes')).toHaveTextContent(
      'Lost',
    );
    expect(screen.getByText('0 controlled cells')).toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', { name: 'Select agent Rook' }),
    );
    expect(screen.getByLabelText('Recent territory changes')).toHaveTextContent(
      'Gained',
    );
    expect(screen.getByText('1 controlled cells')).toBeInTheDocument();
    await user.click(screen.getByText('Latest structured observation'));
    expect(
      screen.getByText('Latest structured observation').closest('details'),
    ).toHaveTextContent('Capture: eligible');
    await waitFor(() =>
      expect(mapLibreMock.latestSourceData).toEqual(
        expect.objectContaining({
          features: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({
                controllerColor: '#ffd166',
                controllerName: 'Rook',
              }),
            }),
          ]),
        }),
      ),
    );
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
    await user.click(screen.getByRole('button', { name: 'Reset world' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('unexported telemetry'),
    );
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

  it('enters and cancels explicit personality editing without a request', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox', {
      name: 'Personality directive',
    });
    expect(textarea).toHaveValue(world.agents[0]!.personality);
    await user.type(textarea, ' unsaved');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText(world.agents[0]!.personality)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('applies a trimmed custom personality only after Apply', async () => {
    const custom = 'Choose open adjacent cells before waiting.';
    const changed = withPersonality(initial, world.agents[0]!.id, custom);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => jsonResponse(initial))
        .mockImplementationOnce(() =>
          jsonResponse({ snapshot: changed, agent: changed.world.agents[0] }),
        ),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox', {
      name: 'Personality directive',
    });
    await user.clear(textarea);
    await user.type(textarea, `  ${custom}  `);
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(custom)).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      `${apiBaseForTest()}/agents/${world.agents[0]!.id}/personality`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ personality: custom }),
      }),
    );
  });

  it.each(PERSONALITY_PRESETS)(
    'selects and applies the $name preset explicitly',
    async (preset) => {
      const changed = withPersonality(
        initial,
        world.agents[0]!.id,
        preset.personality,
      );
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementationOnce(() => jsonResponse(initial))
          .mockImplementationOnce(() =>
            jsonResponse({
              snapshot: changed,
              agent: changed.world.agents[0],
            }),
          ),
      );
      const user = userEvent.setup();
      render(<WorldLab />);
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.selectOptions(
        screen.getByLabelText('Personality preset'),
        preset.id,
      );
      expect(
        screen.getByRole('textbox', { name: 'Personality directive' }),
      ).toHaveValue(preset.personality);
      expect(fetch).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      expect(await screen.findByText(preset.personality)).toBeInTheDocument();
      expect(screen.getByText(preset.name)).toBeInTheDocument();
    },
  );

  it('shows character count, empty validation, and Custom preset state', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox', {
      name: 'Personality directive',
    });
    expect(
      screen.getByText(`${world.agents[0]!.personality.length}/600`),
    ).toBeInTheDocument();
    expect(textarea).toHaveAttribute('maxlength', '600');
    expect(screen.getByLabelText('Personality preset')).toHaveValue('custom');
    await user.clear(textarea);
    expect(screen.getByText('0/600')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a personality between 1 and 600 characters.',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('disables personality mutations during playback and pending requests', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(
      screen.getByRole('textbox', { name: 'Personality directive' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Restore default personalities' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    let resolveUpdate!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise((resolve) => (resolveUpdate = resolve)),
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Applying…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset world' })).toBeDisabled();
    resolveUpdate(
      new Response(
        JSON.stringify({ snapshot: initial, agent: initial.world.agents[0] }),
        { status: 200 },
      ),
    );
    await screen.findByRole('button', { name: 'Edit' });
  });

  it('keeps an edited personality through world reset', async () => {
    const edited = withPersonality(
      afterInfection(),
      world.agents[0]!.id,
      'Persistent lab edit.',
    );
    const resetWithEdit = withPersonality(
      initial,
      world.agents[0]!.id,
      'Persistent lab edit.',
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => jsonResponse(edited))
        .mockImplementationOnce(() =>
          jsonResponse({ snapshot: resetWithEdit }),
        ),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(
      await screen.findByRole('button', { name: 'Reset world' }),
    );
    expect(await screen.findByText('Persistent lab edit.')).toBeInTheDocument();
    expect(screen.getByText('Turn 0')).toBeInTheDocument();
  });

  it('confirms restoring defaults and preserves current world progress', async () => {
    const progressed = withPersonality(
      afterInfection(),
      world.agents[0]!.id,
      'Temporary edit.',
    );
    const restored = simulationSnapshotSchema.parse({
      ...progressed,
      world: {
        ...progressed.world,
        agents: progressed.world.agents.map((agent, index) => ({
          ...agent,
          personality: world.agents[index]!.personality,
        })),
      },
    });
    const confirm = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => jsonResponse(progressed))
        .mockImplementationOnce(() => jsonResponse({ snapshot: restored })),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    const restore = await screen.findByRole('button', {
      name: 'Restore default personalities',
    });
    await user.click(restore);
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(restore);
    expect(
      await screen.findByRole('group', {
        name: 'Active personality configuration',
      }),
    ).toHaveTextContent(world.agents[0]!.personality);
    expect(screen.getByText('Turn 1')).toBeInTheDocument();
    expect(screen.getByTestId('infected-count')).toHaveTextContent(
      '1 rendered infected',
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an active edit from the immutable latest observation', async () => {
    const changed = withPersonality(
      afterInfection(),
      world.agents[0]!.id,
      'New active personality.',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(changed)),
    );
    render(<WorldLab />);
    expect(
      await screen.findByText('New active personality.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(world.agents[0]!.personality, { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Immutable input supplied for turn 1/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The active personality has changed since this observation.',
      ),
    ).toBeInTheDocument();
  });

  it('shows current and selected-agent experiment usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(afterInfection())),
    );
    render(<WorldLab />);
    expect(
      await screen.findByLabelText('Current experiment usage'),
    ).toHaveTextContent('1 turns');
    expect(screen.getByLabelText('Current experiment usage')).toHaveTextContent(
      '0.0 credits known cost',
    );
    expect(screen.getByLabelText('Selected agent usage')).toHaveTextContent(
      '1 turns',
    );
  });

  it('preselects one agent, supports multi-select and previews server-owned export', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(
      await screen.findByRole('button', { name: 'Export this agent' }),
    );
    expect(screen.getByRole('checkbox', { name: /Ember/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Rook/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Rook/ }));
    vi.mocked(fetch).mockImplementationOnce(() =>
      jsonResponse({
        experimentId: initial.experiment.id,
        matchingRecordCount: 0,
        matchingCommunicationCount: 0,
        matchingControlChangeCount: 0,
        selectedAgentCount: 2,
        retention: {
          limit: 5000,
          totalCompletedTurns: 0,
          retainedTurns: 0,
          droppedRecords: 0,
          complete: true,
          requestedRangeExtendsBeyondRetention: false,
        },
        knownCostCredits: 0,
        turnsWithUnknownCost: 0,
        serializedUtf8Bytes: 900,
        approximateAiInputTokens: 225,
        tokenEstimateMethod: 'ceil(UTF-8 bytes / 4)',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Preview export' }));
    expect(await screen.findByLabelText('Export preview')).toHaveTextContent(
      '900 bytes',
    );
    const request = JSON.parse(
      String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body),
    );
    expect(request.agents).toEqual({
      mode: 'selected',
      agentIds: [world.agents[0]!.id, world.agents[1]!.id],
    });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(
      screen.getByRole('button', { name: 'Preview export' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    for (const agent of world.agents)
      expect(
        screen.getByRole('checkbox', { name: new RegExp(agent.name) }),
      ).toBeChecked();
  });

  it('offers every tier, turn selector, outcome/action filters, and dependent Custom switches', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByText('Experiment Export'));
    const level = screen.getByLabelText('Export level');
    expect(level).toHaveTextContent('Minimal');
    expect(level).toHaveTextContent('Standard');
    expect(level).toHaveTextContent('Full safe');
    expect(level).toHaveTextContent('Custom');
    expect(screen.getByLabelText('JSON serialization')).toHaveValue('compact');
    expect(screen.getByRole('checkbox', { name: 'message' })).toBeChecked();
    await user.selectOptions(
      screen.getByLabelText('JSON serialization'),
      'pretty',
    );
    await user.selectOptions(level, 'custom');
    expect(screen.getByText('Advanced Custom switches')).toBeInTheDocument();
    const observations = screen.getByRole('checkbox', {
      name: 'Turn observations',
    });
    await user.click(observations);
    expect(
      screen.getByRole('checkbox', { name: 'Nearby agents' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Recent events' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', {
        name: 'Recent communications in observations',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Canonical communications' }),
    ).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Turn range'), 'range');
    expect(screen.getByLabelText('From turn')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'accepted' }));
    await user.click(screen.getByRole('checkbox', { name: 'rejected' }));
    await user.click(screen.getByRole('checkbox', { name: 'provider error' }));
    expect(
      screen.getByRole('button', { name: 'Preview export' }),
    ).toBeDisabled();
  });

  it('copies and downloads the exact same validated generated JSON and revokes its URL', async () => {
    const user = userEvent.setup();
    const progressed = afterInfection();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(progressed)),
    );
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const createObjectURL = vi.fn(() => 'blob:experiment');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<WorldLab />);
    await user.click(
      await screen.findByRole('button', { name: 'Export this agent' }),
    );
    const document = minimalExportDocument(progressed);
    vi.mocked(fetch).mockImplementationOnce(() => jsonResponse({ document }));
    await user.click(screen.getByRole('button', { name: 'Generate JSON' }));
    await user.click(await screen.findByRole('button', { name: 'Copy JSON' }));
    expect(clipboardWrite).toHaveBeenCalledWith(
      JSON.stringify(experimentExportDocumentSchema.parse(document)),
    );
    clipboardWrite.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy JSON' }));
    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download JSON' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:experiment');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('auto-pauses a fully infected world and disables automatic Start only', async () => {
    const infected = simulationSnapshotSchema.parse({
      ...initial,
      world: {
        ...initial.world,
        hexes: initial.world.hexes.map((hex) => ({
          ...hex,
          state: 'infected' as const,
          controllerAgentId: initial.world.agents[0]!.id,
        })),
      },
      experiment: {
        ...initial.experiment,
        currentTerritory: initial.experiment.currentTerritory.map(
          (entry, index) => ({
            ...entry,
            controlledCellCount: index === 0 ? 61 : 0,
          }),
        ),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(infected)),
    );
    render(<WorldLab />);
    expect(
      await screen.findByText(/Development world fully infected/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Single turn' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset world' })).toBeEnabled();
  });
});

function minimalExportDocument(snapshot: SimulationSnapshot) {
  const turn = snapshot.turns[0]!;
  const agent = snapshot.world.agents[0]!;
  return {
    schemaVersion: 3 as const,
    generatedAt: '2026-08-13T12:00:02.000Z',
    experiment: {
      id: snapshot.experiment.id,
      startedAt: snapshot.experiment.startedAt,
      providerMode: snapshot.providerMode,
    },
    retention: {
      limit: 5000,
      totalCompletedTurns: 1,
      retainedTurns: 1,
      firstRetainedTurn: 1,
      lastRetainedTurn: 1,
      droppedRecords: 0,
      complete: true,
      requestedRangeExtendsBeyondRetention: false,
    },
    filters: {
      agents: { mode: 'selected' as const, agentIds: [agent.id] },
      turns: { mode: 'entire-retained' as const },
      outcomes: ['accepted', 'rejected', 'provider-error'] as const,
      actions: ['move', 'infect', 'capture', 'message', 'wait'] as const,
      level: 'minimal' as const,
    },
    selection: {
      selectedAgentIds: [agent.id],
      matchingRecordCount: 1,
      matchingCommunicationCount: 0,
      matchingControlChangeCount: 0,
      firstMatchingTurn: 1,
      lastMatchingTurn: 1,
    },
    agents: [agent],
    metrics: {
      aggregate: snapshot.experiment.metrics.aggregate,
      byAgent: [snapshot.experiment.metrics.byAgent[0]!],
    },
    currentTerritory: snapshot.experiment.currentTerritory,
    communications: [],
    controlChanges: [],
    turns: [
      {
        turnNumber: turn.turnNumber,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        agentId: turn.agentId,
        outcome: turn.outcome,
        ...(turn.outcome === 'accepted'
          ? {
              requestedAction: turn.requestedAction,
              summary: turn.summary,
              eventSummary: `Infected ${agent.currentCell}.`,
              provider: turn.provider,
            }
          : {}),
      },
    ],
  };
}

function apiBaseForTest() {
  return process.env.NEXT_PUBLIC_GAME_API_BASE_URL ?? '/api/game/simulation';
}
