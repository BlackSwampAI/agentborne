'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PERSONALITY_MAX_LENGTH,
  experimentExportPreviewSchema,
  experimentExportRequestSchema,
  experimentExportResponseSchema,
  personalitySchema,
  resetSimulationResponseSchema,
  restoreDefaultPersonalitiesResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
  updateAgentPersonalityRequestSchema,
  updateAgentPersonalityResponseSchema,
  type AgentId,
  type AgentTurnRecord,
  type CustomExportOptions,
  type ExperimentExportDocument,
  type ExperimentExportPreview,
  type ExperimentExportRequest,
  type H3Cell,
  type SimulationSnapshot,
} from '@agentborne/shared';
import {
  matchingPersonalityPreset,
  PERSONALITY_PRESETS,
} from './personality-presets';
import { WorldMap } from './world-map';

const latitude = Number(process.env.NEXT_PUBLIC_DEV_MAP_LATITUDE ?? 41.6528);
const longitude = Number(process.env.NEXT_PUBLIC_DEV_MAP_LONGITUDE ?? -83.5379);
const resolution = Number(process.env.NEXT_PUBLIC_DEV_MAP_H3_RESOLUTION ?? 9);
const apiBase =
  process.env.NEXT_PUBLIC_GAME_API_BASE_URL ?? '/api/game/simulation';

export function WorldLab() {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [selectedCell, setSelectedCell] = useState<H3Cell | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [running, setRunning] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [personalityPending, setPersonalityPending] = useState(false);
  const [personalityNotice, setPersonalityNotice] = useState<string | null>(
    null,
  );
  const [speed, setSpeed] = useState(1_000);
  const [uiError, setUiError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportAgentIds, setExportAgentIds] = useState<AgentId[]>([]);
  const inFlightRef = useRef(false);

  const applySnapshot = useCallback((next: SimulationSnapshot) => {
    setSnapshot(next);
    if (next.world.hexes.every(({ state }) => state === 'infected'))
      setRunning(false);
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
    if (
      snapshot &&
      snapshot.experiment.totalCompletedTurns > 0 &&
      !window.confirm(
        `Reset World will discard ${snapshot.experiment.totalCompletedTurns} completed experiment turn records and all unexported telemetry. Continue?`,
      )
    )
      return;
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
      const payload = resetSimulationResponseSchema.parse(
        await response.json(),
      );
      setSnapshot(payload.snapshot);
      setSelectedCell(payload.snapshot.world.hexes[0]!.cell);
      setSelectedAgentId(payload.snapshot.world.agents[0]!.id);
    } catch {
      setUiError('Reset failed safely. The existing world was left intact.');
    } finally {
      setResetting(false);
    }
  };

  const updatePersonality = async (
    agentId: AgentId,
    personality: string,
  ): Promise<boolean> => {
    const request = updateAgentPersonalityRequestSchema.safeParse({
      personality,
    });
    if (!request.success) return false;
    setPersonalityPending(true);
    setPersonalityNotice(null);
    setUiError(null);
    try {
      const response = await fetch(`${apiBase}/agents/${agentId}/personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
      });
      if (response.status === 409) {
        setUiError(
          'Personality changes are unavailable until the current turn completes.',
        );
        return false;
      }
      if (!response.ok) {
        setUiError('The personality was rejected safely by the Game API.');
        return false;
      }
      const payload = updateAgentPersonalityResponseSchema.parse(
        await response.json(),
      );
      applySnapshot(payload.snapshot);
      setPersonalityNotice(`${payload.agent.name}'s personality was updated.`);
      return true;
    } catch {
      setUiError(
        'Personality update failed safely. The existing personality was left intact.',
      );
      return false;
    } finally {
      setPersonalityPending(false);
    }
  };

  const restoreDefaultPersonalities = async () => {
    if (
      !window.confirm(
        'Restore the original personalities for all six agents? World progress will be preserved.',
      )
    )
      return;
    setPersonalityPending(true);
    setPersonalityNotice(null);
    setUiError(null);
    try {
      const response = await fetch(
        `${apiBase}/personalities/restore-defaults`,
        {
          method: 'POST',
        },
      );
      if (response.status === 409) {
        setUiError(
          'Default personalities cannot be restored until the current turn completes.',
        );
        return;
      }
      if (!response.ok) throw new Error('restore personalities failed');
      const payload = restoreDefaultPersonalitiesResponseSchema.parse(
        await response.json(),
      );
      applySnapshot(payload.snapshot);
      setPersonalityNotice(
        'Default personalities restored. World progress was preserved.',
      );
    } catch {
      setUiError(
        'Restoring default personalities failed safely. Existing configuration was left intact.',
      );
    } finally {
      setPersonalityPending(false);
    }
  };

  const fullyInfected =
    snapshot?.world.hexes.every(({ state }) => state === 'infected') ?? false;
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
  const personalityControlsDisabled =
    running ||
    inFlight ||
    resetting ||
    personalityPending ||
    snapshot.activeAgentId !== null;
  const exportMutationPending =
    running ||
    inFlight ||
    resetting ||
    personalityPending ||
    snapshot.activeAgentId !== null;

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
            onSelectAgent={(agentId) => {
              setSelectedAgentId(agentId);
              const agent = snapshot.world.agents.find(
                ({ id }) => id === agentId,
              );
              if (agent) setSelectedCell(agent.currentCell);
            }}
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
                  disabled={
                    inFlight ||
                    personalityPending ||
                    fullyInfected ||
                    !snapshot.providerConfigured
                  }
                  type="button"
                  onClick={() => setRunning(true)}
                >
                  Start
                </button>
              )}
              <button
                disabled={
                  inFlight ||
                  running ||
                  personalityPending ||
                  !snapshot.providerConfigured
                }
                type="button"
                onClick={() => void executeTurn()}
              >
                Single turn
              </button>
              <button
                disabled={inFlight || resetting || personalityPending}
                type="button"
                onClick={() => void reset()}
              >
                Reset world
              </button>
            </div>
            <button
              className="secondary-action"
              disabled={personalityControlsDisabled}
              type="button"
              onClick={() => void restoreDefaultPersonalities()}
            >
              Restore default personalities
            </button>
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
            <ExperimentUsageMeter snapshot={snapshot} />
            {fullyInfected && (
              <p className="callout success" role="status">
                Development world fully infected. Automatic playback is paused;
                Single turn remains a manual cost-incurring diagnostic action.
              </p>
            )}
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
            {personalityNotice && (
              <p className="callout success" role="status">
                {personalityNotice}
              </p>
            )}
          </section>

          <PublicWorldChat
            agents={snapshot.world.agents}
            events={snapshot.world.events.filter(
              (
                event,
              ): event is Extract<
                SimulationSnapshot['world']['events'][number],
                { type: 'public-message-sent' }
              > => event.type === 'public-message-sent',
            )}
            turns={snapshot.turns}
          />

          {selectedAgent && (
            <AgentInspector
              key={`${selectedAgent.id}:${selectedAgent.personality}`}
              agent={selectedAgent}
              cellState={
                snapshot.world.hexes.find(
                  ({ cell }) => cell === selectedAgent.currentCell,
                )!.state
              }
              latestTurn={latestTurn}
              turns={snapshot.turns}
              directMessages={snapshot.world.events.filter(
                (
                  event,
                ): event is Extract<
                  SimulationSnapshot['world']['events'][number],
                  { type: 'direct-message-sent' }
                > =>
                  event.type === 'direct-message-sent' &&
                  (event.agentId === selectedAgent.id ||
                    event.recipientId === selectedAgent.id),
              )}
              agents={snapshot.world.agents}
              mutationDisabled={personalityControlsDisabled}
              mutationPending={personalityPending}
              onApplyPersonality={updatePersonality}
              metrics={
                snapshot.experiment.metrics.byAgent.find(
                  ({ agentId }) => agentId === selectedAgent.id,
                )?.metrics
              }
              controlledCellCount={
                snapshot.experiment.currentTerritory.find(
                  ({ agentId }) => agentId === selectedAgent.id,
                )?.controlledCellCount ?? 0
              }
              controlChanges={snapshot.world.events.filter(
                (
                  event,
                ): event is Extract<
                  SimulationSnapshot['world']['events'][number],
                  { type: 'hex-captured' }
                > =>
                  event.type === 'hex-captured' &&
                  (event.controllerAgentId === selectedAgent.id ||
                    event.previousControllerAgentId === selectedAgent.id),
              )}
              onExportAgent={(agentId) => {
                setRunning(false);
                setExportAgentIds([agentId]);
                setExportOpen(true);
              }}
            />
          )}

          <ExperimentExportPanel
            agents={snapshot.world.agents}
            disabled={exportMutationPending}
            open={exportOpen}
            selectedAgentIds={exportAgentIds}
            onOpenChange={setExportOpen}
            onSelectionChange={setExportAgentIds}
          />

          <TerritoryScoreboard entries={snapshot.experiment.currentTerritory} />

          {selectedHex && (
            <section
              className="panel selected-panel"
              aria-label="Selected hex inspector"
            >
              <p className="panel-kicker">Selected hex</p>
              <h2>{selectedHex.state === 'infected' ? 'Infected' : 'Open'}</h2>
              <dl>
                <div>
                  <dt>H3 index</dt>
                  <dd>{selectedHex.cell}</dd>
                </div>
                <div>
                  <dt>Controlled by</dt>
                  <dd>
                    {selectedHex.state === 'infected' ? (
                      <>
                        <span
                          className="agent-swatch"
                          style={{
                            background: snapshot.world.agents.find(
                              ({ id }) => id === selectedHex.controllerAgentId,
                            )?.color,
                          }}
                        />
                        {snapshot.world.agents.find(
                          ({ id }) => id === selectedHex.controllerAgentId,
                        )?.name ?? selectedHex.controllerAgentId}
                      </>
                    ) : (
                      'No controller'
                    )}
                  </dd>
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

          <EventLog turns={snapshot.turns} agents={snapshot.world.agents} />
        </aside>
      </div>
    </main>
  );
}

function PublicWorldChat({
  agents,
  events,
  turns,
}: {
  agents: SimulationSnapshot['world']['agents'];
  events: Array<
    Extract<
      SimulationSnapshot['world']['events'][number],
      { type: 'public-message-sent' }
    >
  >;
  turns: AgentTurnRecord[];
}) {
  return (
    <section className="panel world-chat-panel" aria-label="Public world chat">
      <p className="panel-kicker">Visible to every agent</p>
      <h2>Public world chat</h2>
      {events.length === 0 ? (
        <p className="muted">No public messages yet.</p>
      ) : (
        <ol className="world-chat-feed">
          {events.slice(-12).map((event) => {
            const sender = agents.find(({ id }) => id === event.agentId);
            const turnNumber = turns.find(
              (turn) =>
                turn.outcome !== 'provider-error' &&
                turn.communicationResult.requested &&
                turn.communicationResult.accepted &&
                turn.communicationResult.event.id === event.id,
            )?.turnNumber;
            return (
              <li key={event.id}>
                <div>
                  <strong>{sender?.name ?? event.agentId}</strong>
                  <small>
                    Turn {turnNumber ?? '—'} ·{' '}
                    {formatTimestamp(event.occurredAt)}
                  </small>
                </div>
                <p>{event.message}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TerritoryScoreboard({
  entries,
}: {
  entries: SimulationSnapshot['experiment']['currentTerritory'];
}) {
  return (
    <section
      className="panel territory-panel"
      aria-label="Territory scoreboard"
    >
      <p className="panel-kicker">Current authoritative control</p>
      <h2>Territory scoreboard</h2>
      <ol>
        {entries.map((entry) => (
          <li key={entry.agentId}>
            <span
              className="agent-swatch"
              style={{ background: entry.color }}
            />
            <span>{entry.name}</span>
            <strong>{entry.controlledCellCount}</strong>
            <span className="sr-only">controlled cells</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AgentInspector({
  agent,
  cellState,
  latestTurn,
  turns,
  directMessages,
  agents,
  mutationDisabled,
  mutationPending,
  onApplyPersonality,
  metrics,
  controlledCellCount,
  controlChanges,
  onExportAgent,
}: {
  agent: SimulationSnapshot['world']['agents'][number];
  cellState: 'open' | 'infected';
  latestTurn?: AgentTurnRecord;
  turns: AgentTurnRecord[];
  directMessages: Array<
    Extract<
      SimulationSnapshot['world']['events'][number],
      { type: 'direct-message-sent' }
    >
  >;
  agents: SimulationSnapshot['world']['agents'];
  mutationDisabled: boolean;
  mutationPending: boolean;
  onApplyPersonality: (
    agentId: AgentId,
    personality: string,
  ) => Promise<boolean>;
  metrics?: SimulationSnapshot['experiment']['metrics']['aggregate'];
  controlledCellCount: number;
  controlChanges: Array<
    Extract<
      SimulationSnapshot['world']['events'][number],
      { type: 'hex-captured' }
    >
  >;
  onExportAgent: (agentId: AgentId) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(agent.personality);
  const [editError, setEditError] = useState<string | null>(null);

  const draftPreset = matchingPersonalityPreset(draft);
  const activePreset = matchingPersonalityPreset(agent.personality);

  const apply = async () => {
    const parsed = personalitySchema.safeParse(draft);
    if (!parsed.success) {
      setEditError(
        `Enter a personality between 1 and ${PERSONALITY_MAX_LENGTH} characters.`,
      );
      return;
    }
    setEditError(null);
    if (await onApplyPersonality(agent.id, parsed.data)) setEditing(false);
  };

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
      <div className="agent-usage" aria-label="Selected agent usage">
        <strong>Experiment usage</strong>
        <span>{metrics?.totalTurns ?? 0} turns</span>
        <span>{metrics?.publicMessagesSent ?? 0} public sent</span>
        <span>{metrics?.directMessagesSent ?? 0} direct sent</span>
        <span>{metrics?.directMessagesReceived ?? 0} direct received</span>
        <span>{controlledCellCount} controlled cells</span>
        <span>{formatCost(metrics?.knownCostCredits ?? 0)} known cost</span>
        {(metrics?.turnsWithUnknownCost ?? 0) > 0 && (
          <span>{metrics?.turnsWithUnknownCost} unknown-cost turns</span>
        )}
      </div>
      <h3>Recent territory gains and losses</h3>
      {controlChanges.length === 0 ? (
        <p className="muted">
          No territory gains or losses for this agent yet.
        </p>
      ) : (
        <ol className="control-history" aria-label="Recent territory changes">
          {controlChanges.slice(-6).map((change) => {
            const gained = change.controllerAgentId === agent.id;
            const otherId = gained
              ? change.previousControllerAgentId
              : change.controllerAgentId;
            const other = agents.find(({ id }) => id === otherId);
            return (
              <li key={change.id}>
                <strong>{gained ? 'Gained' : 'Lost'}</strong> {change.cell}{' '}
                {gained ? 'from' : 'to'} {other?.name ?? otherId}
              </li>
            );
          })}
        </ol>
      )}
      <button type="button" onClick={() => onExportAgent(agent.id)}>
        Export this agent
      </button>
      <h3>Direct-message history</h3>
      {directMessages.length === 0 ? (
        <p className="muted">No direct messages for this agent yet.</p>
      ) : (
        <ol
          className="communication-history"
          aria-label="Direct-message history"
        >
          {directMessages.slice(-12).map((communication) => {
            const sender = agents.find(
              ({ id }) => id === communication.agentId,
            );
            const recipient = agents.find(
              ({ id }) => id === communication.recipientId,
            );
            const direction =
              communication.agentId === agent.id ? 'Sent' : 'Received';
            const other =
              communication.agentId === agent.id ? recipient : sender;
            const turnNumber = turns.find(
              (turn) =>
                turn.outcome !== 'provider-error' &&
                turn.communicationResult.requested &&
                turn.communicationResult.accepted &&
                turn.communicationResult.event.id === communication.id,
            )?.turnNumber;
            return (
              <li key={communication.id}>
                <div>
                  <strong>{direction}</strong>{' '}
                  <span>
                    {other?.name ??
                      (direction === 'Sent'
                        ? communication.recipientId
                        : communication.agentId)}
                  </span>
                </div>
                <p>{communication.message}</p>
                <small>
                  Turn {turnNumber ?? '—'} ·{' '}
                  {formatTimestamp(communication.occurredAt)}
                </small>
              </li>
            );
          })}
        </ol>
      )}
      <div className="personality-heading">
        <h3>Active personality</h3>
        {!editing && (
          <button
            disabled={mutationDisabled}
            type="button"
            onClick={() => {
              setDraft(agent.personality);
              setEditError(null);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="personality-editor">
          <label>
            Personality preset
            <select
              disabled={mutationDisabled}
              value={draftPreset?.id ?? 'custom'}
              onChange={(event) => {
                const preset = PERSONALITY_PRESETS.find(
                  ({ id }) => id === event.target.value,
                );
                if (preset) {
                  setDraft(preset.personality);
                  setEditError(null);
                }
              }}
            >
              <option value="custom">Custom</option>
              {PERSONALITY_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Personality directive
            <textarea
              aria-describedby="personality-character-count personality-edit-help"
              disabled={mutationDisabled}
              maxLength={PERSONALITY_MAX_LENGTH}
              rows={6}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setEditError(null);
              }}
            />
          </label>
          <div className="editor-meta">
            <span id="personality-edit-help">
              Presets populate the editor; Apply commits the change.
            </span>
            <span id="personality-character-count">
              {draft.length}/{PERSONALITY_MAX_LENGTH}
            </span>
          </div>
          {editError && (
            <p className="inline-error" role="alert">
              {editError}
            </p>
          )}
          <div className="editor-actions">
            <button
              disabled={mutationDisabled}
              type="button"
              onClick={() => void apply()}
            >
              {mutationPending ? 'Applying…' : 'Apply'}
            </button>
            <button
              disabled={mutationPending}
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(agent.personality);
                setEditError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          aria-label="Active personality configuration"
          className="active-personality"
          role="group"
        >
          <p>{agent.personality}</p>
          <span>{activePreset?.name ?? 'Custom'}</span>
        </div>
      )}
      {latestTurn ? (
        <div className="turn-detail">
          <h3>Latest turn</h3>
          <p className={`outcome ${latestTurn.outcome}`}>
            {latestTurn.outcome}
          </p>
          {latestTurn.outcome !== 'provider-error' ? (
            <>
              <p>
                <strong>World action:</strong>{' '}
                {formatAction(latestTurn.worldAction)}
                {' · '}
                {latestTurn.worldActionResult.accepted
                  ? 'accepted'
                  : 'rejected'}
              </p>
              <p>
                <strong>Summary:</strong> {latestTurn.summary}
              </p>
              {!latestTurn.worldActionResult.accepted && (
                <p>
                  <strong>World-action rejection:</strong>{' '}
                  {latestTurn.worldActionResult.reason} ·{' '}
                  {latestTurn.worldActionResult.details}
                </p>
              )}
              <div
                className="component-result"
                aria-label="Communication result"
              >
                <strong>Communication:</strong>{' '}
                {!latestTurn.communicationResult.requested
                  ? 'none requested'
                  : latestTurn.communicationResult.accepted
                    ? `${latestTurn.communicationResult.event.channel} accepted`
                    : `${latestTurn.communicationResult.attempt.channel} rejected · ${latestTurn.communicationResult.reason}`}
              </div>
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
            <p className="observation-note">
              Immutable input supplied for turn {latestTurn.turnNumber}. It is
              not rewritten when the active personality changes.
            </p>
            {latestTurn.observation.personality !== agent.personality && (
              <p className="observation-difference">
                The active personality has changed since this observation.
              </p>
            )}
            <p>
              <strong>Observed personality:</strong>{' '}
              {latestTurn.observation.personality}
            </p>
            <p>
              Current: {latestTurn.observation.currentCell.cell} (
              {latestTurn.observation.currentCell.state})
            </p>
            <p>
              Capture:{' '}
              {latestTurn.observation.captureEligibility.eligible
                ? 'eligible'
                : `blocked · ${latestTurn.observation.captureEligibility.blockedReason}`}
            </p>
            <p>
              Adjacent:{' '}
              {latestTurn.observation.adjacentCells
                .map(({ cell, state }) => `${cell} (${state})`)
                .join(', ')}
            </p>
            <p>
              Nearby:{' '}
              {latestTurn.observation.nearbyAgents
                .map(({ name, distance }) => `${name} (${distance})`)
                .join(', ') || 'none'}
            </p>
            <p>
              Recent public events: {latestTurn.observation.recentEvents.length}
            </p>
            <p>
              Recent public messages:{' '}
              {latestTurn.observation.recentPublicMessages.length}
            </p>
            <ol className="observation-communications">
              {latestTurn.observation.recentPublicMessages.map(
                (communication) => (
                  <li key={communication.eventId}>
                    {communication.senderName}: {communication.message}
                  </li>
                ),
              )}
            </ol>
            <p>
              Recent direct messages:{' '}
              {latestTurn.observation.recentDirectMessages.length}
            </p>
            <ol className="observation-communications">
              {latestTurn.observation.recentDirectMessages.map(
                (communication) => (
                  <li key={communication.eventId}>
                    {communication.direction}: {communication.senderName} →{' '}
                    {communication.recipientName}: {communication.message}
                  </li>
                ),
              )}
            </ol>
          </details>
        </div>
      ) : (
        <p className="muted">No completed turn for this agent yet.</p>
      )}
      <h3>Recent records</h3>
      <ol className="compact-history">
        {turns
          .filter(({ agentId }) => agentId === agent.id)
          .slice(-5)
          .toReversed()
          .map((turn) => (
            <li key={turn.turnNumber}>
              Turn {turn.turnNumber}: {turn.outcome}
            </li>
          ))}
      </ol>
    </section>
  );
}

function ExperimentUsageMeter({ snapshot }: { snapshot: SimulationSnapshot }) {
  const metrics = snapshot.experiment.metrics.aggregate;
  return (
    <div className="usage-meter" aria-label="Current experiment usage">
      <strong>Current experiment</strong>
      <span>{snapshot.experiment.totalCompletedTurns} turns</span>
      <span>{metrics.publicMessagesAccepted} public messages</span>
      <span>{metrics.directMessagesDelivered} direct messages</span>
      <span>{formatCost(metrics.knownCostCredits)} known cost</span>
      <span>
        {metrics.tokens.totalTokens ??
          (metrics.tokens.promptTokens ?? 0) +
            (metrics.tokens.completionTokens ?? 0)}{' '}
        tokens
      </span>
      {metrics.turnsWithUnknownCost > 0 && (
        <span>{metrics.turnsWithUnknownCost} unknown-cost turns</span>
      )}
    </div>
  );
}

const defaultCustomOptions: CustomExportOptions = {
  turnObservations: true,
  personalityTextHistory: true,
  nearbyAgents: true,
  recentEvents: true,
  recentPublicMessages: true,
  recentDirectMessages: true,
  recentControlChanges: true,
  validationDetails: true,
  resultingEvents: true,
  providerUsageMetadata: true,
  initialWorldState: false,
  currentWorldState: true,
  computedMetrics: true,
  communications: true,
  controlChanges: true,
};

function ExperimentExportPanel({
  agents,
  disabled,
  open,
  selectedAgentIds,
  onOpenChange,
  onSelectionChange,
}: {
  agents: SimulationSnapshot['world']['agents'];
  disabled: boolean;
  open: boolean;
  selectedAgentIds: AgentId[];
  onOpenChange: (open: boolean) => void;
  onSelectionChange: (ids: AgentId[]) => void;
}) {
  const [level, setLevel] =
    useState<ExperimentExportRequest['level']>('minimal');
  const [serialization, setSerialization] =
    useState<ExperimentExportRequest['serialization']>('compact');
  const [turnMode, setTurnMode] = useState<
    'entire-retained' | 'latest' | 'range'
  >('entire-retained');
  const [latestCount, setLatestCount] = useState<10 | 25 | 50 | 120>(120);
  const [fromTurn, setFromTurn] = useState(1);
  const [toTurn, setToTurn] = useState(120);
  const [outcomes, setOutcomes] = useState<
    Array<'accepted' | 'rejected' | 'provider-error'>
  >(['accepted', 'rejected', 'provider-error']);
  const [actions, setActions] = useState<
    Array<'move' | 'infect' | 'capture' | 'wait'>
  >(['move', 'infect', 'capture', 'wait']);
  const [communicationChannel, setCommunicationChannel] = useState<
    'all' | 'public' | 'direct'
  >('all');
  const [communicationStatus, setCommunicationStatus] = useState<
    'all' | 'accepted' | 'rejected'
  >('all');
  const [custom, setCustom] = useState(defaultCustomOptions);
  const [preview, setPreview] = useState<ExperimentExportPreview | null>(null);
  const [document, setDocument] = useState<ExperimentExportDocument | null>(
    null,
  );
  const [generatedRequestJson, setGeneratedRequestJson] = useState<
    string | null
  >(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (open && detailsRef.current) detailsRef.current.open = true;
  }, [open]);

  const requestInput = {
    agents:
      selectedAgentIds.length === agents.length
        ? { mode: 'all' as const }
        : { mode: 'selected' as const, agentIds: selectedAgentIds },
    turns:
      turnMode === 'entire-retained'
        ? { mode: 'entire-retained' as const }
        : turnMode === 'latest'
          ? { mode: 'latest' as const, count: latestCount }
          : { mode: 'range' as const, fromTurn, toTurn },
    outcomes,
    actions,
    communications: {
      channel: communicationChannel,
      status: communicationStatus,
    },
    level,
    serialization,
    ...(level === 'custom' ? { custom } : {}),
  };
  const parsedRequest = experimentExportRequestSchema.safeParse(requestInput);
  const generationDisabled = disabled || pending || !parsedRequest.success;
  const currentRequestJson = parsedRequest.success
    ? JSON.stringify(parsedRequest.data)
    : null;
  const documentIsCurrent =
    document !== null && generatedRequestJson === currentRequestJson;

  const requestExport = async (previewOnly: boolean) => {
    if (!parsedRequest.success) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `${apiBase}/experiment/export${previewOnly ? '/preview' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsedRequest.data),
        },
      );
      if (response.status === 409) {
        setNotice(
          'Pause playback and wait for pending mutations before exporting.',
        );
        return;
      }
      if (!response.ok) throw new Error('export request failed');
      if (previewOnly) {
        setPreview(experimentExportPreviewSchema.parse(await response.json()));
        setDocument(null);
        setGeneratedRequestJson(null);
        setNotice('Export preview updated.');
      } else {
        const payload = experimentExportResponseSchema.parse(
          await response.json(),
        );
        setDocument(payload.document);
        setGeneratedRequestJson(JSON.stringify(parsedRequest.data));
        setNotice('Export JSON generated and schema-validated.');
      }
    } catch {
      setNotice('Export failed safely. Review the selection and try again.');
    } finally {
      setPending(false);
    }
  };

  const copyJson = async () => {
    if (!document || !documentIsCurrent) return;
    try {
      await navigator.clipboard.writeText(serializeExportDocument(document));
      setNotice('Export JSON copied to the clipboard.');
    } catch {
      setNotice('Copy failed. Clipboard permission may be unavailable.');
    }
  };

  const downloadJson = () => {
    if (!document || !documentIsCurrent) return;
    try {
      const json = serializeExportDocument(document);
      const url = URL.createObjectURL(
        new Blob([json], { type: 'application/json' }),
      );
      const link = window.document.createElement('a');
      const scope =
        document.selection.selectedAgentIds.length === agents.length
          ? 'all-agents'
          : document.selection.selectedAgentIds.length === 1
            ? 'one-agent'
            : `${document.selection.selectedAgentIds.length}-agents`;
      const range =
        document.filters.turns.mode === 'range'
          ? `turns-${document.filters.turns.fromTurn}-${document.filters.turns.toTurn}`
          : document.filters.turns.mode === 'latest'
            ? `latest-${document.filters.turns.count}`
            : 'entire-retained';
      link.href = url;
      link.download = `agentborne-experiment-${document.experiment.id}-${scope}-${range}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Export JSON download started.');
    } catch {
      setNotice('Download failed safely.');
    }
  };

  const toggle = <T extends string>(values: T[], value: T): T[] =>
    values.includes(value)
      ? values.filter((candidate) => candidate !== value)
      : [...values, value];

  return (
    <details
      className="panel export-panel"
      ref={detailsRef}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        onOpenChange(nextOpen);
        if (nextOpen && selectedAgentIds.length === 0)
          onSelectionChange(agents.map(({ id }) => id));
      }}
    >
      <summary>Experiment Export</summary>
      <p className="muted">
        Server-owned retained telemetry; exports never change prompts or model
        usage.
      </p>
      <fieldset>
        <legend>Agents</legend>
        <div className="selection-actions">
          <button
            type="button"
            onClick={() => onSelectionChange(agents.map(({ id }) => id))}
          >
            Select all
          </button>
          <button type="button" onClick={() => onSelectionChange([])}>
            Clear
          </button>
        </div>
        {agents.map((agent) => (
          <label className="checkbox-row" key={agent.id}>
            <input
              checked={selectedAgentIds.includes(agent.id)}
              type="checkbox"
              onChange={() =>
                onSelectionChange(toggle(selectedAgentIds, agent.id))
              }
            />
            <span
              className="agent-swatch"
              style={{ background: agent.color }}
            />
            {agent.name}
          </label>
        ))}
      </fieldset>
      <label>
        Export level
        <select
          value={level}
          onChange={(event) =>
            setLevel(event.target.value as ExperimentExportRequest['level'])
          }
        >
          <option value="minimal">Minimal</option>
          <option value="standard">Standard</option>
          <option value="full-safe">Full safe</option>
          <option value="custom">Custom export</option>
        </select>
      </label>
      <fieldset>
        <legend>Advanced JSON options</legend>
        <label>
          JSON serialization
          <select
            value={serialization}
            onChange={(event) =>
              setSerialization(
                event.target.value as ExperimentExportRequest['serialization'],
              )
            }
          >
            <option value="compact">Compact · AI sharing default</option>
            <option value="pretty">Pretty · human review</option>
          </select>
        </label>
      </fieldset>
      <label>
        Turn range
        <select
          value={turnMode}
          onChange={(event) =>
            setTurnMode(event.target.value as typeof turnMode)
          }
        >
          <option value="entire-retained">Entire retained experiment</option>
          <option value="latest">Latest matching records</option>
          <option value="range">Custom absolute range</option>
        </select>
      </label>
      {turnMode === 'latest' && (
        <label>
          Latest count
          <select
            value={latestCount}
            onChange={(event) =>
              setLatestCount(Number(event.target.value) as typeof latestCount)
            }
          >
            {[10, 25, 50, 120].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
      )}
      {turnMode === 'range' && (
        <div className="range-row">
          <label>
            From turn
            <input
              min="1"
              type="number"
              value={fromTurn}
              onChange={(event) => setFromTurn(Number(event.target.value))}
            />
          </label>
          <label>
            To turn
            <input
              min="1"
              type="number"
              value={toTurn}
              onChange={(event) => setToTurn(Number(event.target.value))}
            />
          </label>
        </div>
      )}
      <FilterChecks
        label="Outcomes"
        options={['accepted', 'rejected', 'provider-error']}
        selected={outcomes}
        onToggle={(value) => setOutcomes(toggle(outcomes, value))}
      />
      <FilterChecks
        label="Actions"
        options={['move', 'infect', 'capture', 'wait']}
        selected={actions}
        onToggle={(value) => setActions(toggle(actions, value))}
      />
      <div className="range-row">
        <label>
          Communication channel
          <select
            value={communicationChannel}
            onChange={(event) =>
              setCommunicationChannel(
                event.target.value as typeof communicationChannel,
              )
            }
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="direct">Direct</option>
          </select>
        </label>
        <label>
          Communication result
          <select
            value={communicationStatus}
            onChange={(event) =>
              setCommunicationStatus(
                event.target.value as typeof communicationStatus,
              )
            }
          >
            <option value="all">All</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      {level === 'custom' && (
        <fieldset>
          <legend>Advanced Custom switches</legend>
          {(Object.keys(custom) as Array<keyof CustomExportOptions>).map(
            (key) => (
              <label className="checkbox-row" key={key}>
                <input
                  checked={custom[key]}
                  disabled={
                    (key === 'nearbyAgents' ||
                      key === 'recentEvents' ||
                      key === 'recentPublicMessages' ||
                      key === 'recentDirectMessages' ||
                      key === 'recentControlChanges') &&
                    !custom.turnObservations
                  }
                  type="checkbox"
                  onChange={() =>
                    setCustom((current) => {
                      const next = { ...current, [key]: !current[key] };
                      if (
                        key === 'turnObservations' &&
                        !next.turnObservations
                      ) {
                        next.nearbyAgents = false;
                        next.recentEvents = false;
                        next.recentPublicMessages = false;
                        next.recentDirectMessages = false;
                        next.recentControlChanges = false;
                      }
                      return next;
                    })
                  }
                />
                {customOptionLabel(key)}
              </label>
            ),
          )}
        </fieldset>
      )}
      {open && !parsedRequest.success && (
        <p className="inline-error" role="alert">
          Select at least one agent, outcome, and action, and enter a valid
          range.
        </p>
      )}
      {disabled && (
        <p className="muted">
          Pause playback and wait for all turn, reset, and personality work to
          finish.
        </p>
      )}
      <div className="export-actions">
        <button
          disabled={generationDisabled}
          type="button"
          onClick={() => void requestExport(true)}
        >
          Preview export
        </button>
        <button
          disabled={generationDisabled}
          type="button"
          onClick={() => void requestExport(false)}
        >
          Generate JSON
        </button>
        <button
          disabled={!documentIsCurrent}
          type="button"
          onClick={() => void copyJson()}
        >
          Copy JSON
        </button>
        <button
          disabled={!documentIsCurrent}
          type="button"
          onClick={downloadJson}
        >
          Download JSON
        </button>
      </div>
      {preview && (
        <dl className="preview-grid" aria-label="Export preview">
          <div>
            <dt>Matching</dt>
            <dd>{preview.matchingTurnCount} turns</dd>
          </div>
          <div>
            <dt>Communications</dt>
            <dd>{preview.matchingCommunicationCount} matched</dd>
          </div>
          <div>
            <dt>Control changes</dt>
            <dd>{preview.matchingControlChangeCount} matched</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{preview.serializedUtf8Bytes} bytes</dd>
          </div>
          <div>
            <dt>Approx. AI input</dt>
            <dd>{preview.approximateAiInputTokens} tokens</dd>
          </div>
          <div>
            <dt>Selected cost</dt>
            <dd>{formatCost(preview.knownCostCredits)}</dd>
          </div>
        </dl>
      )}
      {notice && (
        <p className="callout" role="status">
          {notice}
        </p>
      )}
    </details>
  );
}

function FilterChecks<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {options.map((option) => (
        <label className="checkbox-row" key={option}>
          <input
            checked={selected.includes(option)}
            type="checkbox"
            onChange={() => onToggle(option)}
          />
          {option.replaceAll('-', ' ')}
        </label>
      ))}
    </fieldset>
  );
}

function customOptionLabel(key: keyof CustomExportOptions): string {
  return {
    turnObservations: 'Turn observations',
    personalityTextHistory: 'Personality text and history',
    nearbyAgents: 'Nearby agents',
    recentEvents: 'Recent events',
    recentPublicMessages: 'Recent public messages in observations',
    recentDirectMessages: 'Recent direct messages in observations',
    recentControlChanges: 'Recent control changes in observations',
    validationDetails: 'Validation details',
    resultingEvents: 'Resulting events',
    providerUsageMetadata: 'Provider usage metadata',
    initialWorldState: 'Initial world state',
    currentWorldState: 'Current world state',
    computedMetrics: 'Computed metrics',
    communications: 'Canonical communications',
    controlChanges: 'Canonical control changes',
  }[key];
}

function formatCost(cost: number): string {
  return `${cost.toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0')} credits`;
}

function serializeExportDocument(document: ExperimentExportDocument): string {
  return document.filters.serialization === 'pretty'
    ? JSON.stringify(document, null, 2)
    : JSON.stringify(document);
}

function EventLog({
  turns,
  agents,
}: {
  turns: AgentTurnRecord[];
  agents: SimulationSnapshot['world']['agents'];
}) {
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
          turns
            .slice(-20)
            .toReversed()
            .map((turn) => (
              <li data-outcome={turn.outcome} key={turn.turnNumber}>
                <time>#{turn.turnNumber}</time>
                <span>{formatTurn(turn, agents)}</span>
              </li>
            ))
        )}
      </ol>
    </section>
  );
}

function formatAction(
  action: Extract<
    AgentTurnRecord,
    { outcome: 'accepted' | 'rejected' }
  >['worldAction'],
) {
  if (action.type === 'move') return `move → ${action.targetCell}`;
  return action.type;
}

function formatTurn(
  turn: AgentTurnRecord,
  agents: SimulationSnapshot['world']['agents'],
) {
  if (turn.outcome === 'provider-error')
    return `Provider failure · ${turn.failure.message}`;
  const communication = !turn.communicationResult.requested
    ? ''
    : turn.communicationResult.accepted
      ? ` + ${turn.communicationResult.event.channel} message accepted`
      : ` + ${turn.communicationResult.attempt.channel} message rejected (${turn.communicationResult.reason})`;
  if (!turn.worldActionResult.accepted)
    return `Rejected ${formatAction(turn.worldAction)} · ${turn.worldActionResult.reason}${communication}`;
  const event = turn.worldActionResult.event;
  if (event.type === 'agent-moved')
    return `Movement · ${event.toCell}${communication}`;
  if (event.type === 'hex-infected')
    return `Infection · ${event.cell}${communication}`;
  if (event.type === 'hex-captured') {
    const capturer = agents.find(({ id }) => id === event.controllerAgentId);
    const previous = agents.find(
      ({ id }) => id === event.previousControllerAgentId,
    );
    return `${capturer?.name ?? event.controllerAgentId} captured ${event.cell} from ${previous?.name ?? event.previousControllerAgentId}.${communication}`;
  }
  return `Waited${communication}`;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
