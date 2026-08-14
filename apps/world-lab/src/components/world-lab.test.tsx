import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gridDisk } from 'h3-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simulationSnapshotSchema, type SimulationSnapshot } from '@agentborne/shared';
import { createDevelopmentWorld } from '@agentborne/world-engine';
import { WorldLab } from './world-lab';

let mapClick: ((event: { features: Array<{ properties: { cell: string } }> }) => void) | undefined;

vi.mock('maplibre-gl', () => {
  class Map {
    source = { setData: vi.fn() };
    addControl() {}
    addLayer() {}
    addSource() {}
    fitBounds() {}
    getCanvas() { return { style: { cursor: '' } }; }
    getSource() { return this.source; }
    on(event: string, layerOrCallback: unknown, callback?: typeof mapClick) {
      if (event === 'load' && typeof layerOrCallback === 'function') layerOrCallback();
      if (event === 'click' && typeof callback === 'function') mapClick = callback;
    }
    remove() {}
  }
  class Marker {
    constructor(private options: { element: HTMLElement }) {}
    setLngLat() { return this; }
    addTo() { document.body.append(this.options.element); return this; }
    remove() { this.options.element.remove(); }
  }
  return {
    Map,
    Marker,
    LngLatBounds: class { extend() { return this; } },
    NavigationControl: class {},
    AttributionControl: class {},
  };
});

const world = createDevelopmentWorld({ generatedAt: '2026-08-13T12:00:00.000Z' });
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
    (cell) => cell !== agent.currentCell && world.hexes.some((hex) => hex.cell === cell),
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
    provider: { provider: 'scripted-test' as const, model: 'test', latencyMs: 0 },
  };
  return simulationSnapshotSchema.parse({
    ...initial,
    world: {
      ...world,
      hexes: world.hexes.map((hex) =>
        hex.cell === agent.currentCell ? { ...hex, state: 'infected' as const } : hex,
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
  mapClick = undefined;
  vi.stubGlobal('fetch', vi.fn(() => jsonResponse(initial)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorldLab', () => {
  it('renders all controls, status, H3 readiness, and six visible markers', async () => {
    render(<WorldLab />);
    expect(await screen.findByRole('heading', { name: 'World Lab' })).toBeInTheDocument();
    expect(await screen.findByText(/H3 overlay ready · 61 cells · 6 agents/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Single turn' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    expect(screen.getByLabelText('Playback speed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Select agent/ })).toHaveLength(6);
    expect(screen.getByText('Automated-test provider')).toBeInTheDocument();
  });

  it('selects an agent and populates its inspector', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Select agent Rook' }));
    expect(screen.getByRole('heading', { name: /Rook/ })).toBeInTheDocument();
    expect(screen.getByText(world.agents[1]!.personality)).toBeInTheDocument();
    expect(screen.getByText(world.agents[1]!.id)).toBeInTheDocument();
  });

  it('executes one turn and renders infection and decision details safely', async () => {
    const changed = afterInfection();
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockImplementationOnce(() => jsonResponse(initial))
        .mockImplementationOnce(() => jsonResponse({ snapshot: changed, turn: changed.turns[0] })),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    await user.click(await screen.findByRole('button', { name: 'Single turn' }));
    expect(await screen.findByText('Infection · ' + world.agents[0]!.currentCell)).toBeInTheDocument();
    expect(screen.getByText('Infecting this open cell.')).toBeInTheDocument();
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
      vi.fn()
        .mockImplementationOnce(() => jsonResponse(changed))
        .mockImplementationOnce(() => jsonResponse({ snapshot: initial })),
    );
    const user = userEvent.setup();
    render(<WorldLab />);
    expect(await screen.findByText('Infection · ' + world.agents[0]!.currentCell)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByText('Development world loaded with six agents.')).toBeInTheDocument());
    expect(screen.getByText('Turn 0')).toBeInTheDocument();
  });

  it('supports hex selection independently of agent selection', async () => {
    render(<WorldLab />);
    await screen.findByRole('button', { name: 'Select agent Ember' });
    const target = world.hexes[1]!.cell;
    act(() => mapClick?.({ features: [{ properties: { cell: target } }] }));
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
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(unconfigured)));
    render(<WorldLab />);
    expect(await screen.findByText(/Model calls unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Single turn' })).toBeDisabled();
  });
});
