'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resetSimulationResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
  type AgentId,
  type AgentTurnRecord,
  type H3Cell,
  type SimulationSnapshot,
} from '@agentborne/shared';
import { WorldMap } from './world-map';

const latitude = Number(process.env.NEXT_PUBLIC_DEV_MAP_LATITUDE ?? 41.6528);
const longitude = Number(process.env.NEXT_PUBLIC_DEV_MAP_LONGITUDE ?? -83.5379);
const resolution = Number(process.env.NEXT_PUBLIC_DEV_MAP_H3_RESOLUTION ?? 9);
const apiBase = '/api/game/simulation';

export function WorldLab() {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [selectedCell, setSelectedCell] = useState<H3Cell | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [running, setRunning] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [speed, setSpeed] = useState(1_000);
  const [uiError, setUiError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const applySnapshot = useCallback((next: SimulationSnapshot) => {
    setSnapshot(next);
    setSelectedCell((current) => current ?? next.world.hexes[0]!.cell);
    setSelectedAgentId((current) => current ?? next.world.agents[0]!.id);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch(apiBase)
      .then(async (response) => {
        if (!response.ok) throw new Error('The Game API is unavailable.');
        return simulationSnapshotSchema.parse(await response.json());
      })
      .then((next) => {
        if (alive) applySnapshot(next);
      })
      .catch(() => {
        if (alive)
          setUiError('The Game API is unavailable. Start it with pnpm dev.');
      });
    return () => {
      alive = false;
    };
  }, [applySnapshot]);

  const executeTurn = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);
    setUiError(null);
    try {
      const response = await fetch(`${apiBase}/turn`, { method: 'POST' });
      if (response.status === 409) {
        setUiError('Another turn is already in progress.');
        return;
      }
      if (!response.ok) throw new Error('turn request failed');
      const payload = singleTurnResponseSchema.parse(await response.json());
      applySnapshot(payload.snapshot);
    } catch {
      setUiError('The turn failed safely. Check the Game API and try again.');
      setRunning(false);
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    if (!running || inFlight || resetting) return;
    const timer = window.setTimeout(() => void executeTurn(), speed);
    return () => window.clearTimeout(timer);
  }, [executeTurn, inFlight, resetting, running, snapshot?.turnNumber, speed]);

  const reset = async () => {
    if (inFlightRef.current) return;
    setRunning(false);
    setResetting(true);
    setUiError(null);
    try {
      const response = await fetch(`${apiBase}/reset`, { method: 'POST' });
      if (response.status === 409) {
        setUiError('Reset is unavailable until the current turn completes.');
        return;
      }
      if (!response.ok) throw new Error('reset request failed');
      const payload = resetSimulationResponseSchema.parse(await response.json());
      setSnapshot(payload.snapshot);
      setSelectedCell(payload.snapshot.world.hexes[0]!.cell);
      setSelectedAgentId(payload.snapshot.world.agents[0]!.id);
    } catch {
      setUiError('Reset failed safely. The existing world was left intact.');
    } finally {
      setResetting(false);
    }
  };

  if (!snapshot) {
    return (
      <main className="loading-state">
        <h1>World Lab</h1>
        <p role="alert">{uiError ?? 'Loading simulation…'}</p>
      </main>
    );
  }

  const selectedAgent = snapshot.world.agents.find(
    ({ id }) => id === selectedAgentId,
  );
  const selectedHex = snapshot.world.hexes.find(
    ({ cell }) => cell === selectedCell,
  );
  const latestTurn = selectedAgent
    ? snapshot.turns.findLast(({ agentId }) => agentId === selectedAgent.id)
    : undefined;
  const status = resetting
    ? 'resetting'
    : inFlight
      ? 'waiting-for-model'
      : snapshot.status === 'configuration-error' ||
          snapshot.status === 'provider-error'
        ? snapshot.status
        : running
          ? 'running'
          : 'paused';
  const nextAgent = snapshot.world.agents.find(
    ({ id }) => id === snapshot.nextAgentId,
  );

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Developer simulation interface</p>
          <h1>World Lab</h1>
        </div>
        <div className="status-group">
          <p className={`status ${status}`}>
            <span aria-hidden="true" /> {status.replaceAll('-', ' ')}
          </p>
          <p className="provider-badge">
            {snapshot.providerMode === 'openrouter'
              ? 'Genuine model · OpenRouter'
              : 'Automated-test provider'}
          </p>
        </div>
      </header>

      <div className="workspace">
        <section className="map-panel" aria-label="Development world map">
          <WorldMap
            latitude={latitude}
            longitude={longitude}
            hexes={snapshot.world.hexes}
            agents={snapshot.world.agents}
            selectedCell={selectedCell ?? snapshot.world.hexes[0]!.cell}
            selectedAgentId={selectedAgentId}
            onSelectCell={setSelectedCell}
            onSelectAgent={setSelectedAgentId}
          />
          <div className="map-caption">
            <span>Development location: Toledo, Ohio</span>
            <span>
              H3 resolution {resolution} · {snapshot.world.hexes.length} cells
            </span>
          </div>
        </section>

        <aside className="sidebar">
          <section className="panel controls-panel">
            <p className="panel-kicker">Turn {snapshot.turnNumber}</p>
            <h2>Simulation controls</h2>
            <p className="next-agent">
              {inFlight ? 'Acting' : 'Next'}: <strong>{nextAgent?.name}</strong>
            </p>
            <div className="control-row">
              {running ? (
                <button type="button" onClick={() => setRunning(false)}>
                  Pause
                </button>
              ) : (
                <button
                  disabled={inFlight || !snapshot.providerConfigured}
                  type="button"
                  onClick={() => setRunning(true)}
                >
                  Start
                </button>
              )}
              <button
                disabled={inFlight || running || !snapshot.providerConfigured}
                type="button"
                onClick={() => void executeTurn()}
              >
                Single turn
              </button>
              <button
                disabled={inFlight || resetting}
                type="button"
                onClick={() => void reset()}
              >
                Reset
              </button>
            </div>
            <label className="speed-control">
              Playback speed
              <select
                aria-label="Playback speed"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value={2_000}>Slow · 2s</option>
                <option value={1_000}>Normal · 1s</option>
                <option value={250}>Fast · 0.25s</option>
              </select>
            </label>
            {!snapshot.providerConfigured && (
              <p className="callout configuration" role="alert">
                Model calls unavailable. Set OPENROUTER_API_KEY on the Game API
                server and restart pnpm dev.
              </p>
            )}
            {uiError && (
              <p className="callout error" role="alert">
                {uiError}
              </p>
            )}
          </section>

          {selectedAgent && (
            <AgentInspector
              agent={selectedAgent}
              cellState={
                snapshot.world.hexes.find(
                  ({ cell }) => cell === selectedAgent.currentCell,
                )!.state
              }
              latestTurn={latestTurn}
              turns={snapshot.turns.filter(
                ({ agentId }) => agentId === selectedAgent.id,
              )}
            />
          )}

          {selectedHex && (
            <section className="panel selected-panel">
              <p className="panel-kicker">Selected hex</p>
              <h2>{selectedHex.state === 'infected' ? 'Infected' : 'Open'}</h2>
              <dl>
                <div>
                  <dt>H3 index</dt>
                  <dd>{selectedHex.cell}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>
                    <span className={`state-dot ${selectedHex.state}`} />
                    {selectedHex.state}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <EventLog turns={snapshot.turns} />
        </aside>
      </div>
    </main>
  );
}

function AgentInspector({
  agent,
  cellState,
  latestTurn,
  turns,
}: {
  agent: SimulationSnapshot['world']['agents'][number];
  cellState: 'open' | 'infected';
  latestTurn?: AgentTurnRecord;
  turns: AgentTurnRecord[];
}) {
  return (
    <section className="panel agent-inspector" aria-label="Agent inspector">
      <p className="panel-kicker">Agent inspector</p>
      <h2>
        <span className="agent-swatch" style={{ background: agent.color }} />
        {agent.name}
      </h2>
      <dl>
        <div>
          <dt>Stable ID</dt>
          <dd>{agent.id}</dd>
        </div>
        <div>
          <dt>Color</dt>
          <dd>{agent.color}</dd>
        </div>
        <div>
          <dt>Cell</dt>
          <dd>{agent.currentCell}</dd>
        </div>
        <div>
          <dt>Cell state</dt>
          <dd>{cellState}</dd>
        </div>
      </dl>
      <h3>Personality</h3>
      <p>{agent.personality}</p>
      {latestTurn ? (
        <div className="turn-detail">
          <h3>Latest turn</h3>
          <p className={`outcome ${latestTurn.outcome}`}>
            {latestTurn.outcome}
          </p>
          {latestTurn.outcome !== 'provider-error' ? (
            <>
              <p>
                <strong>Requested:</strong>{' '}
                {formatAction(latestTurn.requestedAction)}
              </p>
              <p>
                <strong>Summary:</strong> {latestTurn.summary}
              </p>
              {latestTurn.outcome === 'rejected' && (
                <p>
                  <strong>Rejection:</strong> {latestTurn.validation.reason} ·{' '}
                  {latestTurn.validation.details}
                </p>
              )}
              <p className="provider-meta">
                {latestTurn.provider.provider} · {latestTurn.provider.model} ·{' '}
                {latestTurn.provider.latencyMs}ms
              </p>
            </>
          ) : (
            <>
              <p className="callout error">
                {latestTurn.failure.code}: {latestTurn.failure.message}
              </p>
              {latestTurn.provider && (
                <p className="provider-meta">
                  {latestTurn.provider.provider} · {latestTurn.provider.model} ·{' '}
                  {latestTurn.provider.latencyMs}ms
                </p>
              )}
            </>
          )}
          <details>
            <summary>Latest structured observation</summary>
            <p>
              Current: {latestTurn.observation.currentCell.cell} ({latestTurn.observation.currentCell.state})
            </p>
            <p>Adjacent: {latestTurn.observation.adjacentCells.map(({ cell, state }) => `${cell} (${state})`).join(', ')}</p>
            <p>Nearby: {latestTurn.observation.nearbyAgents.map(({ name, distance }) => `${name} (${distance})`).join(', ') || 'none'}</p>
            <p>Recent public events: {latestTurn.observation.recentEvents.length}</p>
          </details>
        </div>
      ) : (
        <p className="muted">No completed turn for this agent yet.</p>
      )}
      <h3>Recent records</h3>
      <ol className="compact-history">
        {turns.slice(-5).toReversed().map((turn) => (
          <li key={turn.turnNumber}>
            Turn {turn.turnNumber}: {turn.outcome}
          </li>
        ))}
      </ol>
    </section>
  );
}

function EventLog({ turns }: { turns: AgentTurnRecord[] }) {
  return (
    <section className="panel event-panel">
      <p className="panel-kicker">World events</p>
      <h2>Event log</h2>
      <ol aria-label="World event log">
        {turns.length === 0 ? (
          <li>
            <time>Initial</time>
            <span>Development world loaded with six agents.</span>
          </li>
        ) : (
          turns.slice(-20).toReversed().map((turn) => (
            <li data-outcome={turn.outcome} key={turn.turnNumber}>
              <time>#{turn.turnNumber}</time>
              <span>{formatTurn(turn)}</span>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

function formatAction(action: Extract<AgentTurnRecord, { outcome: 'accepted' | 'rejected' }>['requestedAction']) {
  return action.type === 'move' ? `move → ${action.targetCell}` : action.type;
}

function formatTurn(turn: AgentTurnRecord) {
  if (turn.outcome === 'provider-error')
    return `Provider failure · ${turn.failure.message}`;
  if (turn.outcome === 'rejected')
    return `Rejected ${formatAction(turn.requestedAction)} · ${turn.validation.reason}`;
  if (turn.event.type === 'agent-moved') return `Movement · ${turn.event.toCell}`;
  if (turn.event.type === 'hex-infected') return `Infection · ${turn.event.cell}`;
  return 'Waited';
}
