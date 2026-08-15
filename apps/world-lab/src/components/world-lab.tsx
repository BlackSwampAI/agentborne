'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PERSONALITY_MAX_LENGTH,
  cancelSimulationResponseSchema,
  cancelledTurnResponseSchema,
  experimentExportPreviewSchema,
  experimentExportRequestSchema,
  experimentExportResponseSchema,
  experimentImportResponseSchema,
  modelCatalogResponseSchema,
  personalitySchema,
  resetSimulationResponseSchema,
  restoreDefaultPersonalitiesResponseSchema,
  simulationSnapshotSchema,
  singleTurnResponseSchema,
  updateAgentPersonalityRequestSchema,
  updateAgentPersonalityResponseSchema,
  updateExperimentModelsResponseSchema,
  verifyModelResponseSchema,
  type AgentId,
  type AgentTurnRecord,
  type CustomExportOptions,
  type ExperimentExportDocument,
  type ExperimentExportPreview,
  type ExperimentExportRequest,
  type H3Cell,
  type CompatibleModel,
  type ModelCatalogResponse,
  type ModelVerification,
  type ExperimentModelConfiguration,
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
  const [runToTurn200, setRunToTurn200] = useState(false);
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
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [modelVerifications, setModelVerifications] = useState<
    Record<string, ModelVerification>
  >({});
  const [verifyingModelId, setVerifyingModelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const inFlightRef = useRef(false);
  const runToTurn200Ref = useRef(false);
  const completedTurnsRef = useRef(0);

  useEffect(() => {
    runToTurn200Ref.current = runToTurn200;
  }, [runToTurn200]);

  const applySnapshot = useCallback((next: SimulationSnapshot) => {
    completedTurnsRef.current = next.experiment.totalCompletedTurns;
    setSnapshot(next);
    if (
      next.status === 'provider-error' ||
      next.status === 'configuration-error' ||
      next.world.hexes.every(({ state }) => state === 'infected') ||
      (runToTurn200Ref.current && next.experiment.totalCompletedTurns >= 200)
    ) {
      setRunning(false);
      setRunToTurn200(false);
      runToTurn200Ref.current = false;
    }
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

  const providerMode = snapshot?.providerMode;
  useEffect(() => {
    if (providerMode !== 'openrouter') return;
    let alive = true;
    void fetch(`${apiBase}/models`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The model catalog is unavailable.');
        const nextCatalog = modelCatalogResponseSchema.parse(
          await response.json(),
        );
        if (alive) setCatalog(nextCatalog);
        const snapshotResponse = await fetch(apiBase);
        if (snapshotResponse.ok && alive)
          applySnapshot(
            simulationSnapshotSchema.parse(await snapshotResponse.json()),
          );
      })
      .catch(() => {
        if (alive) setUiError('The model catalog is unavailable.');
      })
      .finally(() => {
        if (alive) setCatalogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applySnapshot, providerMode]);

  const refreshCatalog = async () => {
    setCatalogLoading(true);
    try {
      const response = await fetch(`${apiBase}/models/refresh`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('catalog refresh failed');
      setCatalog(modelCatalogResponseSchema.parse(await response.json()));
      const snapshotResponse = await fetch(apiBase);
      if (snapshotResponse.ok)
        applySnapshot(
          simulationSnapshotSchema.parse(await snapshotResponse.json()),
        );
    } catch {
      setUiError(
        'The model catalog refresh failed. A cached catalog may still be available.',
      );
    } finally {
      setCatalogLoading(false);
    }
  };

  const updateModels = async (
    configuration: Omit<ExperimentModelConfiguration, 'locked'>,
  ): Promise<boolean> => {
    setUiError(null);
    try {
      const response = await fetch(`${apiBase}/experiment/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configuration),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => undefined)) as
          { error?: { message?: string } } | undefined;
        setUiError(
          payload?.error?.message ?? 'The model assignment was rejected.',
        );
        return false;
      }
      const payload = updateExperimentModelsResponseSchema.parse(
        await response.json(),
      );
      applySnapshot(payload.snapshot);
      return true;
    } catch {
      setUiError('The model assignment could not be saved.');
      return false;
    }
  };

  const verifyModel = async (modelId: string, force = false) => {
    setVerifyingModelId(modelId);
    setUiError(null);
    try {
      const response = await fetch(`${apiBase}/models/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, force }),
      });
      const body = await response.json();
      if (!response.ok) {
        const error = body as { error?: { message?: string } };
        setUiError(error.error?.message ?? 'The compatibility test failed.');
        return;
      }
      const { verification } = verifyModelResponseSchema.parse(body);
      setModelVerifications((current) => ({
        ...current,
        [verification.modelId]: verification,
      }));
    } catch {
      setUiError('The compatibility test could not be completed.');
    } finally {
      setVerifyingModelId(null);
    }
  };

  const importExperiment = async (file: File): Promise<void> => {
    if (file.size > 5_000_000) {
      setUiError('Experiment import files must be 5 MB or smaller.');
      return;
    }
    try {
      const document = JSON.parse(await file.text()) as unknown;
      const response = await fetch(`${apiBase}/experiment/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document }),
      });
      const body = await response.json();
      if (!response.ok) {
        const error = body as { error?: { message?: string } };
        setUiError(
          error.error?.message ?? 'The experiment import was rejected.',
        );
        return;
      }
      const payload = experimentImportResponseSchema.parse(body);
      applySnapshot(payload.snapshot);
      setPersonalityNotice(payload.message);
    } catch {
      setUiError('The selected file is not a valid experiment export.');
    }
  };

  const executeTurn = useCallback(async () => {
    if (inFlightRef.current) return;
    if (runToTurn200Ref.current && completedTurnsRef.current >= 200) {
      setRunning(false);
      setRunToTurn200(false);
      runToTurn200Ref.current = false;
      return;
    }
    inFlightRef.current = true;
    setInFlight(true);
    setUiError(null);
    try {
      const response = await fetch(`${apiBase}/turn`, { method: 'POST' });
      if (response.status === 409) {
        setUiError('Another turn is already in progress.');
        setRunning(false);
        setRunToTurn200(false);
        runToTurn200Ref.current = false;
        return;
      }
      if (!response.ok) throw new Error('turn request failed');
      const body: unknown = await response.json();
      const cancellation = cancelledTurnResponseSchema.safeParse(body);
      if (cancellation.success) {
        applySnapshot(cancellation.data.snapshot);
        setUiError('The request was cancelled without consuming a turn.');
        return;
      }
      const payload = singleTurnResponseSchema.parse(body);
      applySnapshot(payload.snapshot);
      if (payload.turn.outcome === 'provider-error') {
        setRunning(false);
        setRunToTurn200(false);
        runToTurn200Ref.current = false;
        const failedAgent = payload.snapshot.world.agents.find(
          ({ id }) => id === payload.turn.agentId,
        );
        setUiError(
          `Turn stopped (${payload.turn.failure.code}): ${payload.turn.failure.message} Agent ${failedAgent?.name ?? payload.turn.agentId} · model ${payload.turn.failure.model ?? payload.turn.provider?.model ?? 'unavailable'}.`,
        );
      }
    } catch {
      setUiError('The turn failed safely. Check the Game API and try again.');
      setRunning(false);
      setRunToTurn200(false);
      runToTurn200Ref.current = false;
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  }, [applySnapshot]);

  const cancelCurrentRequest = async () => {
    setCancelling(true);
    setRunning(false);
    setRunToTurn200(false);
    runToTurn200Ref.current = false;
    try {
      const response = await fetch(`${apiBase}/turn/cancel`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        const error = body as { error?: { message?: string } };
        setUiError(
          error.error?.message ?? 'The request could not be cancelled.',
        );
        return;
      }
      applySnapshot(cancelSimulationResponseSchema.parse(body).snapshot);
    } catch {
      setUiError('The cancellation request could not reach the Game API.');
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!running || inFlight || resetting) return;
    if (runToTurn200Ref.current && completedTurnsRef.current >= 200) return;
    const timer = window.setTimeout(() => void executeTurn(), speed);
    return () => window.clearTimeout(timer);
  }, [executeTurn, inFlight, resetting, running, snapshot?.turnNumber, speed]);

  useEffect(() => {
    if (!snapshot?.activeAgentId || inFlight) return;
    const timer = window.setInterval(() => {
      void fetch(apiBase)
        .then(async (response) => {
          if (!response.ok) return;
          applySnapshot(simulationSnapshotSchema.parse(await response.json()));
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [applySnapshot, inFlight, snapshot?.activeAgentId]);

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
    setRunToTurn200(false);
    runToTurn200Ref.current = false;
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
      completedTurnsRef.current =
        payload.snapshot.experiment.totalCompletedTurns;
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
        'Restore the milestone defaults for all eight agents? World progress will be preserved.',
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
  const selectedHexController =
    selectedHex?.state === 'infected'
      ? snapshot.world.agents.find(
          ({ id }) => id === selectedHex.controllerAgentId,
        )
      : undefined;
  const selectedHexAlliance = selectedHexController
    ? snapshot.world.alliances.find(({ memberAgentIds }) =>
        memberAgentIds.includes(selectedHexController.id),
      )
    : undefined;
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
  const modelsReady = snapshot.resolvedModels.every(
    ({ available }) => available,
  );
  const publicMessages = snapshot.world.events.filter(
    (
      event,
    ): event is Extract<
      SimulationSnapshot['world']['events'][number],
      { type: 'public-message-sent' }
    > => event.type === 'public-message-sent',
  );

  return (
    <main
      className={`world-lab-shell${chatCollapsed ? ' chat-collapsed' : ''}`}
    >
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

      <section className="command-bar" aria-label="Experiment command bar">
        <div className="command-summary">
          <strong>Turn {snapshot.turnNumber}</strong>
          <span>{status.replaceAll('-', ' ')}</span>
          <span>
            {formatCost(snapshot.experiment.metrics.aggregate.knownCostCredits)}
          </span>
        </div>
        <div className="control-row command-controls">
          {running ? (
            <button
              type="button"
              onClick={() => {
                setRunning(false);
                setRunToTurn200(false);
                runToTurn200Ref.current = false;
              }}
            >
              Pause
            </button>
          ) : (
            <button
              disabled={
                inFlight ||
                personalityPending ||
                fullyInfected ||
                !snapshot.providerConfigured ||
                !modelsReady
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
              !snapshot.providerConfigured ||
              !modelsReady
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
          <button
            disabled={
              running ||
              inFlight ||
              resetting ||
              personalityPending ||
              !snapshot.providerConfigured ||
              !modelsReady ||
              fullyInfected ||
              snapshot.experiment.totalCompletedTurns >= 200
            }
            type="button"
            onClick={() => {
              runToTurn200Ref.current = true;
              setRunToTurn200(true);
              setRunning(true);
            }}
          >
            Run to turn 200
          </button>
          <span
            className={`cancel-request-slot${
              inFlight || snapshot.activeAgentId !== null ? '' : ' inactive'
            }`}
          >
            <button
              className="secondary-action"
              aria-hidden={!(inFlight || snapshot.activeAgentId !== null)}
              disabled={
                cancelling ||
                snapshot.cancellationRequested ||
                !(inFlight || snapshot.activeAgentId !== null)
              }
              tabIndex={
                inFlight || snapshot.activeAgentId !== null ? undefined : -1
              }
              type="button"
              onClick={() => void cancelCurrentRequest()}
            >
              {snapshot.cancellationRequested || cancelling
                ? 'Cancel…'
                : 'Cancel'}
            </button>
          </span>
        </div>
        {snapshot.providerMode === 'openrouter' ? (
          <ModelConsole
            catalog={catalog}
            loading={catalogLoading || catalog === null}
            snapshot={snapshot}
            disabled={
              running ||
              inFlight ||
              resetting ||
              snapshot.activeAgentId !== null ||
              verifyingModelId !== null
            }
            verifications={modelVerifications}
            verifyingModelId={verifyingModelId}
            onRefresh={refreshCatalog}
            onUpdate={updateModels}
            onVerify={verifyModel}
            onImport={importExperiment}
          />
        ) : (
          <p className="provider-badge">Model: deterministic test provider</p>
        )}
        <div className="command-secondary">
          <span>
            Experiment progress:{' '}
            {Math.min(snapshot.experiment.totalCompletedTurns, 200)}/200
            {runToTurn200 ? ' · bounded run active' : ''}
          </span>
          {!running && (inFlight || snapshot.activeAgentId !== null) && (
            <span role="status">
              Playback is paused; the current provider request is still
              finishing.
            </span>
          )}
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
          <button
            className="secondary-action"
            disabled={personalityControlsDisabled}
            type="button"
            onClick={() => void restoreDefaultPersonalities()}
          >
            Restore default personalities
          </button>
          <ExperimentUsageMeter snapshot={snapshot} />
        </div>
      </section>
      <div className="command-alerts">
        {(!modelsReady || uiError || fullyInfected || personalityNotice) && (
          <div className="command-alert" role="alert">
            {uiError ??
              (fullyInfected
                ? 'Development world fully infected. Automatic playback is paused; Single turn remains a manual cost-incurring diagnostic action.'
                : (personalityNotice ??
                  'Select an available compatible model for every agent before starting.'))}
          </div>
        )}
        {!snapshot.providerConfigured && (
          <div className="command-alert" role="alert">
            Model calls unavailable. Set OPENROUTER_API_KEY on the Game API
            server and restart pnpm dev.
          </div>
        )}
      </div>

      <div className="workspace">
        <AgentRoster
          snapshot={snapshot}
          selectedAgentId={selectedAgentId}
          onSelect={(agentId) => {
            setSelectedAgentId(agentId);
            const agent = snapshot.world.agents.find(
              ({ id }) => id === agentId,
            );
            if (agent) setSelectedCell(agent.currentCell);
          }}
        />
        <section className="map-panel" aria-label="Development world map">
          <WorldMap
            latitude={latitude}
            longitude={longitude}
            hexes={snapshot.world.hexes}
            agents={snapshot.world.agents}
            alliances={snapshot.world.alliances}
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

        <aside className="sidebar details-sidebar">
          {selectedAgent && (
            <AgentInspector
              key={`${selectedAgent.id}:${selectedAgent.personality}`}
              agent={selectedAgent}
              snapshot={snapshot}
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
          <AlliancePanel snapshot={snapshot} />

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
                            background:
                              selectedHexAlliance?.color ??
                              selectedHexController?.color,
                          }}
                        />
                        {selectedHexController?.name ??
                          selectedHex.controllerAgentId}
                      </>
                    ) : (
                      'No controller'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Base color</dt>
                  <dd>{selectedHexController?.color ?? 'None'}</dd>
                </div>
                <div>
                  <dt>Alliance</dt>
                  <dd>
                    {selectedHexAlliance
                      ? selectedHexAlliance.memberAgentIds
                          .map(
                            (id) =>
                              snapshot.world.agents.find(
                                (agent) => agent.id === id,
                              )?.name,
                          )
                          .join(', ')
                      : 'Unaffiliated'}
                  </dd>
                </div>
                <div>
                  <dt>Effective territory color</dt>
                  <dd>
                    {selectedHexAlliance?.color ??
                      selectedHexController?.color ??
                      'None'}
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
        </aside>
      </div>
      <div className="bottom-dock">
        <PublicWorldChat
          agents={snapshot.world.agents}
          events={publicMessages}
          turns={snapshot.turns}
          collapsed={chatCollapsed}
          onCollapsedChange={setChatCollapsed}
        />
        <EventLog turns={snapshot.turns} agents={snapshot.world.agents} />
      </div>
    </main>
  );
}

function ModelConsole({
  catalog,
  loading,
  snapshot,
  disabled,
  verifications,
  verifyingModelId,
  onRefresh,
  onUpdate,
  onVerify,
  onImport,
}: {
  catalog: ModelCatalogResponse | null;
  loading: boolean;
  snapshot: SimulationSnapshot;
  disabled: boolean;
  verifications: Record<string, ModelVerification>;
  verifyingModelId: string | null;
  onRefresh: () => Promise<void>;
  onUpdate: (
    configuration: Omit<ExperimentModelConfiguration, 'locked'>,
  ) => Promise<boolean>;
  onVerify: (modelId: string, force?: boolean) => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'price' | 'context' | 'newest'>(
    'name',
  );
  const models = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(catalog?.models ?? [])]
      .filter(
        ({ id, name, author }) =>
          !query ||
          id.toLowerCase().includes(query) ||
          name.toLowerCase().includes(query) ||
          author.toLowerCase().includes(query),
      )
      .sort((left, right) => {
        if (sort === 'price')
          return (
            Number(left.inputPricePerToken) -
              Number(right.inputPricePerToken) ||
            Number(left.outputPricePerToken) - Number(right.outputPricePerToken)
          );
        if (sort === 'context') return right.contextLength - left.contextLength;
        if (sort === 'newest')
          return (right.createdAt ?? '').localeCompare(left.createdAt ?? '');
        return left.name.localeCompare(right.name);
      });
  }, [catalog, search, sort]);
  const configuration = snapshot.modelConfiguration;
  const selected = catalog?.models.find(
    ({ id }) => id === configuration.globalModelId,
  );
  const locked = disabled;
  const verification = configuration.globalModelId
    ? verifications[configuration.globalModelId]
    : undefined;

  const save = (next: Omit<ExperimentModelConfiguration, 'locked'>) =>
    void onUpdate(next);

  return (
    <details className="model-console">
      <summary>
        Model: {selected?.name ?? configuration.globalModelId ?? 'not selected'}
      </summary>
      <div className="model-console-popover">
        <div className="model-console-heading">
          <div>
            <strong>Compatible OpenRouter models</strong>
            <p>
              {catalog?.models.length ?? 0} catalog compatible ·{' '}
              {catalog?.filteredOutCount ?? 0} filtered out
            </p>
          </div>
          <button
            disabled={loading}
            type="button"
            onClick={() => void onRefresh()}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {catalog?.stale && (
          <p className="catalog-state warning">
            Showing the last successful catalog. {catalog.error?.message}
          </p>
        )}
        {loading && !catalog && (
          <p className="catalog-state">Loading compatible models…</p>
        )}
        {!catalog?.stale && catalog?.error && (
          <p className="catalog-state error">{catalog.error.message}</p>
        )}
        {!loading && catalog && catalog.models.length === 0 && (
          <p className="catalog-state">
            No compatible models are currently available.
          </p>
        )}
        <div className="model-filters">
          <label>
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, slug, or author"
            />
          </label>
          <label>
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="name">Name</option>
              <option value="price">Lowest input price</option>
              <option value="context">Largest context</option>
              <option value="newest">Newest</option>
            </select>
          </label>
        </div>
        <label className="model-select-label">
          Global model
          <select
            disabled={locked}
            value={configuration.globalModelId ?? ''}
            onChange={(event) =>
              save({
                globalModelId: event.target.value || null,
                overrides: configuration.overrides,
              })
            }
          >
            <option value="">Select a model…</option>
            {configuration.globalModelId && !selected && (
              <option value={configuration.globalModelId}>
                {configuration.globalModelId} — unavailable
              </option>
            )}
            {models.map((model) => (
              <option value={model.id} key={model.id}>
                {model.name} · {formatPerMillion(model.inputPricePerToken)} in /{' '}
                {formatPerMillion(model.outputPricePerToken)} out
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={locked || !configuration.globalModelId}
          type="button"
          onClick={() =>
            save({ globalModelId: configuration.globalModelId, overrides: [] })
          }
        >
          Apply global model to all agents
        </button>
        <div className="model-verification">
          <span>
            Catalog compatible:{' '}
            {selected ? 'yes — required metadata advertised' : 'not selected'}
          </span>
          <span>
            Runtime verified:{' '}
            {verification?.status === 'verified'
              ? 'yes'
              : verification?.status === 'failed'
                ? 'failed'
                : 'not tested'}
          </span>
          {verification?.failure && (
            <p className="catalog-state error" role="status">
              {verification.failure.message}
            </p>
          )}
          <button
            disabled={
              locked ||
              !configuration.globalModelId ||
              verifyingModelId === configuration.globalModelId
            }
            type="button"
            onClick={() =>
              configuration.globalModelId &&
              void onVerify(
                configuration.globalModelId,
                verification?.status === 'failed',
              )
            }
          >
            {verifyingModelId === configuration.globalModelId
              ? 'Testing model…'
              : verification?.status === 'failed'
                ? 'Retry model test'
                : 'Test selected model'}
          </button>
          <small>
            Sends one genuine, non-mutating OpenRouter request using the
            production decision contract and may incur a small charge.
          </small>
        </div>
        {selected && <ModelFacts model={selected} />}
        <div className="agent-model-overrides">
          <strong>Agent overrides</strong>
          {snapshot.world.agents.map((agent) => {
            const override = configuration.overrides.find(
              ({ agentId }) => agentId === agent.id,
            );
            return (
              <label key={agent.id}>
                {agent.name}
                <select
                  disabled={locked}
                  value={override?.modelId ?? ''}
                  onChange={(event) => {
                    const withoutAgent = configuration.overrides.filter(
                      ({ agentId }) => agentId !== agent.id,
                    );
                    save({
                      globalModelId: configuration.globalModelId,
                      overrides: event.target.value
                        ? [
                            ...withoutAgent,
                            { agentId: agent.id, modelId: event.target.value },
                          ]
                        : withoutAgent,
                    });
                  }}
                >
                  <option value="">Inherit global</option>
                  {override &&
                    !catalog?.models.some(
                      ({ id }) => id === override.modelId,
                    ) && (
                      <option value={override.modelId}>
                        {override.modelId} — unavailable
                      </option>
                    )}
                  {(catalog?.models ?? []).map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <p className="catalog-state">
          Model changes are available between provider requests and are recorded
          at the next turn boundary.
        </p>
        <label className="model-import-label">
          Import saved experiment model assignments
          <input
            disabled={disabled}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
      </div>
    </details>
  );
}

function ModelFacts({ model }: { model: CompatibleModel }) {
  return (
    <dl className="model-facts">
      <div>
        <dt>Slug</dt>
        <dd>{model.id}</dd>
      </div>
      <div>
        <dt>Author</dt>
        <dd>{model.author}</dd>
      </div>
      <div>
        <dt>Context</dt>
        <dd>{model.contextLength.toLocaleString()} tokens</dd>
      </div>
      <div>
        <dt>Input</dt>
        <dd>{formatPerMillion(model.inputPricePerToken)}</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>{formatPerMillion(model.outputPricePerToken)}</dd>
      </div>
      <div>
        <dt>Pricing</dt>
        <dd>{model.isFree ? 'Free' : 'Paid'}</dd>
      </div>
      <div>
        <dt>Capability</dt>
        <dd>Catalog compatible: text and context requirements met</dd>
      </div>
    </dl>
  );
}

function AgentRoster({
  snapshot,
  selectedAgentId,
  onSelect,
}: {
  snapshot: SimulationSnapshot;
  selectedAgentId: AgentId | null;
  onSelect: (agentId: AgentId) => void;
}) {
  return (
    <aside className="agent-roster" aria-label="Agent roster">
      <p className="panel-kicker">Agents</p>
      {snapshot.world.agents.map((agent) => {
        const territory = snapshot.experiment.currentTerritory.find(
          ({ agentId }) => agentId === agent.id,
        );
        const alliance = snapshot.world.alliances.find(({ memberAgentIds }) =>
          memberAgentIds.includes(agent.id),
        );
        const resolved = snapshot.resolvedModels.find(
          ({ agentId }) => agentId === agent.id,
        )!;
        return (
          <button
            type="button"
            aria-pressed={selectedAgentId === agent.id}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
          >
            <span
              className="agent-swatch"
              style={{ background: alliance?.color ?? agent.color }}
            />
            <span>
              <strong>{agent.name}</strong>
              <small>
                {alliance ? 'Allied' : 'Unaffiliated'} ·{' '}
                {territory?.controlledCellCount ?? 0} cells
              </small>
              <small className={resolved.available ? '' : 'unavailable'}>
                {resolved.source === 'override' ? 'Override' : 'Global'} ·{' '}
                {resolved.modelId ?? 'model required'}
              </small>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

function PublicWorldChat({
  agents,
  events,
  turns,
  collapsed,
  onCollapsedChange,
}: {
  agents: SimulationSnapshot['world']['agents'];
  events: Array<
    Extract<
      SimulationSnapshot['world']['events'][number],
      { type: 'public-message-sent' }
    >
  >;
  turns: AgentTurnRecord[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const [atBottom, setAtBottom] = useState(true);
  const [newMessages, setNewMessages] = useState(0);
  const feedRef = useRef<HTMLOListElement | null>(null);
  const previousCount = useRef(events.length);

  useEffect(() => {
    const feed = feedRef.current;
    if (!collapsed && atBottom && feed) feed.scrollTop = feed.scrollHeight;
  }, [atBottom, collapsed]);

  useEffect(() => {
    const added = Math.max(0, events.length - previousCount.current);
    previousCount.current = events.length;
    if (!added) return;
    const feed = feedRef.current;
    if (atBottom && feed) {
      feed.scrollTop = feed.scrollHeight;
      setNewMessages(0);
    } else setNewMessages((count) => count + added);
  }, [atBottom, events.length]);

  const jumpToNewest = () => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
    setAtBottom(true);
    setNewMessages(0);
  };

  return (
    <section
      className={`panel world-chat-panel${collapsed ? ' chat-collapsed' : ''}`}
      aria-label="Public world chat"
    >
      <div className="dock-heading">
        <div>
          <p className="panel-kicker">Visible to every agent</p>
          <h2>Public world chat</h2>
        </div>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {newMessages > 0 && !collapsed && (
        <button
          className="new-message-button"
          type="button"
          onClick={jumpToNewest}
        >
          {newMessages} new {newMessages === 1 ? 'message' : 'messages'} · Jump
          to newest
        </button>
      )}
      {!collapsed && (
        <>
          {events.length === 0 ? (
            <p className="muted">No public messages yet.</p>
          ) : (
            <ol
              className="world-chat-feed"
              ref={feedRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                const nearBottom =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  36;
                setAtBottom(nearBottom);
                if (nearBottom) setNewMessages(0);
              }}
            >
              {events.map((event) => {
                const sender = agents.find(({ id }) => id === event.agentId);
                const turnNumber = turns.find(
                  (turn) =>
                    turn.outcome !== 'provider-error' &&
                    turn.communicationResult.requested &&
                    turn.communicationResult.accepted &&
                    turn.communicationResult.event.id === event.id,
                )?.turnNumber;
                return (
                  <li key={event.id} style={{ borderLeftColor: sender?.color }}>
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
        </>
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

function AlliancePanel({ snapshot }: { snapshot: SimulationSnapshot }) {
  const unaffiliated = snapshot.world.agents.filter(
    ({ id }) =>
      !snapshot.world.alliances.some(({ memberAgentIds }) =>
        memberAgentIds.includes(id),
      ),
  );
  return (
    <section
      className="panel territory-panel"
      aria-label="Alliance and territory panel"
    >
      <p className="panel-kicker">Formal engine authority</p>
      <h2>Alliances</h2>
      {snapshot.experiment.currentAlliances.length === 0 ? (
        <p className="muted">No active alliances.</p>
      ) : (
        <ol>
          {snapshot.experiment.currentAlliances.map((alliance) => (
            <li key={alliance.allianceId}>
              <span
                className="agent-swatch"
                style={{ background: alliance.color }}
              />
              <span>
                {alliance.members
                  .map(
                    ({ name, controlledCellCount }) =>
                      `${name} (${controlledCellCount})`,
                  )
                  .join(', ')}
              </span>
              <strong>{alliance.totalControlledCellCount}</strong>
              <span className="sr-only">combined controlled cells</span>
            </li>
          ))}
        </ol>
      )}
      <h3>Unaffiliated agents</h3>
      <p>
        {unaffiliated.length
          ? unaffiliated.map(({ name }) => name).join(', ')
          : 'None'}
      </p>
      <h3>Pending proposals</h3>
      {snapshot.world.pendingAllianceProposals.length ? (
        <ol>
          {snapshot.world.pendingAllianceProposals.map((proposal) => (
            <li key={proposal.id}>
              {
                snapshot.world.agents.find(
                  ({ id }) => id === proposal.proposerAgentId,
                )?.name
              }{' '}
              →{' '}
              {
                snapshot.world.agents.find(
                  ({ id }) => id === proposal.recipientAgentId,
                )?.name
              }
              ; expires after turn {proposal.expirationTurn}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No pending alliance proposals.</p>
      )}
      <h3>Recent alliance changes</h3>
      <AllianceEventList snapshot={snapshot} />
    </section>
  );
}

function AllianceEventList({
  snapshot,
  agentId,
}: {
  snapshot: SimulationSnapshot;
  agentId?: AgentId;
}) {
  const events = snapshot.world.events
    .filter(
      (event): event is AllianceWorldEvent =>
        event.type === 'alliance-proposed' ||
        event.type === 'alliance-proposal-closed' ||
        event.type === 'alliance-formed' ||
        event.type === 'agent-joined-alliance' ||
        event.type === 'agent-left-alliance' ||
        event.type === 'alliance-dissolved',
    )
    .filter(
      (event) => !agentId || allianceEventParticipants(event).includes(agentId),
    );
  if (!events.length) return <p className="muted">No alliance changes yet.</p>;
  return (
    <ol className="compact-history">
      {events.slice(-8).map((event) => (
        <li key={event.id}>{formatAllianceEvent(event, snapshot)}</li>
      ))}
    </ol>
  );
}

function AgentInspector({
  agent,
  snapshot,
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
  snapshot: SimulationSnapshot;
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
  const alliance = snapshot.world.alliances.find(({ memberAgentIds }) =>
    memberAgentIds.includes(agent.id),
  );
  const allianceSummary = snapshot.experiment.currentAlliances.find(
    ({ allianceId }) => allianceId === alliance?.id,
  );
  const pendingProposals = snapshot.world.pendingAllianceProposals.filter(
    ({ proposerAgentId, recipientAgentId }) =>
      proposerAgentId === agent.id || recipientAgentId === agent.id,
  );
  const resolvedModel = snapshot.resolvedModels.find(
    ({ agentId }) => agentId === agent.id,
  );

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
          <dt>Base color</dt>
          <dd>{agent.color}</dd>
        </div>
        <div>
          <dt>Effective color</dt>
          <dd>{alliance?.color ?? agent.color}</dd>
        </div>
        <div>
          <dt>Alliance membership</dt>
          <dd>
            {alliance
              ? allianceSummary?.members.map(({ name }) => name).join(', ')
              : 'Unaffiliated'}
          </dd>
        </div>
        <div>
          <dt>Alliance territory</dt>
          <dd>
            {allianceSummary?.totalControlledCellCount ?? 0} controlled cells
          </dd>
        </div>
        <div>
          <dt>Cell</dt>
          <dd>{agent.currentCell}</dd>
        </div>
        <div>
          <dt>Cell state</dt>
          <dd>{cellState}</dd>
        </div>
        <div>
          <dt>Resolved model</dt>
          <dd>
            {resolvedModel?.modelId ?? 'Not selected'} ·{' '}
            {resolvedModel?.source ?? 'missing'}
            {!resolvedModel?.available && ' · unavailable'}
          </dd>
        </div>
      </dl>
      <h3>Relevant pending proposals</h3>
      {pendingProposals.length ? (
        <ol>
          {pendingProposals.map((proposal) => (
            <li key={proposal.id}>
              {
                snapshot.world.agents.find(
                  ({ id }) => id === proposal.proposerAgentId,
                )?.name
              }{' '}
              →{' '}
              {
                snapshot.world.agents.find(
                  ({ id }) => id === proposal.recipientAgentId,
                )?.name
              }
              ; expires after turn {proposal.expirationTurn}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No relevant pending proposals.</p>
      )}
      <h3>Recent alliance changes</h3>
      <AllianceEventList snapshot={snapshot} agentId={agent.id} />
      <div className="agent-usage" aria-label="Selected agent usage">
        <strong>Experiment usage</strong>
        <span>{metrics?.totalTurns ?? 0} turns</span>
        <span>{metrics?.publicMessagesSent ?? 0} public sent</span>
        <span>{metrics?.directMessagesSent ?? 0} direct sent</span>
        <span>{metrics?.directMessagesReceived ?? 0} direct received</span>
        <span>{controlledCellCount} controlled cells</span>
        <span>{formatCost(metrics?.knownCostCredits ?? 0)} known cost</span>
        <span>{metrics?.tokens.promptTokens ?? 0} prompt tokens</span>
        <span>{metrics?.tokens.completionTokens ?? 0} completion tokens</span>
        {(metrics?.tokens.reasoningTokens ?? 0) > 0 && (
          <span>
            {metrics?.tokens.reasoningTokens} reasoning tokens reported
          </span>
        )}
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
              <div className="component-result" aria-label="Diplomacy result">
                <strong>Diplomacy:</strong>{' '}
                {!latestTurn.diplomacyResult.requested
                  ? 'none requested'
                  : latestTurn.diplomacyResult.accepted
                    ? `${latestTurn.diplomacyResult.intent.type} accepted`
                    : `${latestTurn.diplomacyResult.attempt.type} rejected · ${latestTurn.diplomacyResult.reason}`}
              </div>
              <p className="provider-meta">
                {latestTurn.provider.provider} · {latestTurn.provider.model} ·{' '}
                {latestTurn.provider.resolvedModel &&
                latestTurn.provider.resolvedModel !== latestTurn.provider.model
                  ? `resolved ${latestTurn.provider.resolvedModel} · `
                  : ''}
                {latestTurn.provider.latencyMs}ms ·{' '}
                {latestTurn.provider.promptTokens ?? '—'} prompt /{' '}
                {latestTurn.provider.completionTokens ?? '—'} completion
                {latestTurn.provider.reasoningTokens === undefined
                  ? ''
                  : ` / ${latestTurn.provider.reasoningTokens} reasoning`}
                {latestTurn.provider.costCredits === undefined
                  ? ' · cost unavailable'
                  : ` · ${formatCost(latestTurn.provider.costCredits)}`}
              </p>
            </>
          ) : (
            <>
              <p className="callout error">
                {latestTurn.failure.code}: {latestTurn.failure.message}
                {latestTurn.failure.providerMessage
                  ? ` Provider: ${latestTurn.failure.providerMessage}`
                  : ''}
              </p>
              <p className="provider-meta">
                Model{' '}
                {latestTurn.failure.model ??
                  latestTurn.provider?.model ??
                  'unavailable'}
                {latestTurn.failure.httpStatus
                  ? ` · HTTP ${latestTurn.failure.httpStatus}`
                  : ''}
                {latestTurn.failure.providerCode
                  ? ` · ${latestTurn.failure.providerCode}`
                  : ''}
                {latestTurn.failure.requestId
                  ? ` · request ${latestTurn.failure.requestId}`
                  : ''}
                {latestTurn.failure.finishReason
                  ? ` · finish ${latestTurn.failure.finishReason}`
                  : ''}
                {latestTurn.failure.nativeFinishReason
                  ? ` · native ${latestTurn.failure.nativeFinishReason}`
                  : ''}
              </p>
              {latestTurn.provider && (
                <p className="provider-meta">
                  {latestTurn.provider.provider} · {latestTurn.provider.model} ·{' '}
                  {latestTurn.provider.latencyMs}ms
                  {latestTurn.provider.requestId
                    ? ` · request ${latestTurn.provider.requestId}`
                    : ''}
                  {latestTurn.provider.finishReason
                    ? ` · finish ${latestTurn.provider.finishReason}`
                    : ''}
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
            <dt>Diplomacy/alliance events</dt>
            <dd>{preview.matchingDiplomacyEventCount} matched</dd>
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

function formatPerMillion(pricePerToken: string): string {
  const value = Number(pricePerToken) * 1_000_000;
  if (!Number.isFinite(value)) return 'Unavailable';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}/M`;
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
            <span>Development world loaded with eight agents.</span>
          </li>
        ) : (
          turns
            .slice(-20)
            .toReversed()
            .map((turn) => (
              <li
                data-outcome={turn.outcome}
                key={turn.turnNumber}
                style={{
                  borderLeft: `3px solid ${agents.find(({ id }) => id === turn.agentId)?.color ?? '#82938e'}`,
                  paddingLeft: 8,
                }}
              >
                <time>#{turn.turnNumber}</time>
                <span>{formatTurn(turn, agents)}</span>
                <small>
                  {agents.find(({ id }) => id === turn.agentId)?.name ??
                    turn.agentId}
                  {' · '}
                  {turn.provider?.model ?? 'model unavailable'}
                </small>
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
  const diplomacy = !turn.diplomacyResult.requested
    ? ''
    : turn.diplomacyResult.accepted
      ? ` + ${turn.diplomacyResult.intent.type} accepted`
      : ` + ${turn.diplomacyResult.attempt.type} rejected (${turn.diplomacyResult.reason})`;
  if (!turn.worldActionResult.accepted)
    return `Rejected ${formatAction(turn.worldAction)} · ${turn.worldActionResult.reason}${communication}${diplomacy}`;
  const event = turn.worldActionResult.event;
  if (event.type === 'agent-moved')
    return `Movement · ${event.toCell}${communication}${diplomacy}`;
  if (event.type === 'hex-infected')
    return `Infection · ${event.cell}${communication}${diplomacy}`;
  if (event.type === 'hex-captured') {
    const capturer = agents.find(({ id }) => id === event.controllerAgentId);
    const previous = agents.find(
      ({ id }) => id === event.previousControllerAgentId,
    );
    return `${capturer?.name ?? event.controllerAgentId} captured ${event.cell} from ${previous?.name ?? event.previousControllerAgentId}.${communication}${diplomacy}`;
  }
  return `Waited${communication}${diplomacy}`;
}

type AllianceWorldEvent = Extract<
  SimulationSnapshot['world']['events'][number],
  {
    type:
      | 'alliance-proposed'
      | 'alliance-proposal-closed'
      | 'alliance-formed'
      | 'agent-joined-alliance'
      | 'agent-left-alliance'
      | 'alliance-dissolved';
  }
>;

function allianceEventParticipants(event: AllianceWorldEvent): AgentId[] {
  if (event.type === 'alliance-proposed')
    return [event.agentId, event.recipientAgentId];
  if (event.type === 'alliance-proposal-closed')
    return [event.proposerAgentId, event.recipientAgentId];
  if (event.type === 'alliance-formed') return event.memberAgentIds;
  if (event.type === 'agent-joined-alliance') return event.memberAgentIds;
  if (event.type === 'agent-left-alliance')
    return [event.leftAgentId, ...event.remainingMemberAgentIds];
  return event.formerMemberAgentIds;
}

function formatAllianceEvent(
  event: AllianceWorldEvent,
  snapshot: SimulationSnapshot,
): string {
  const name = (id: AgentId) =>
    snapshot.world.agents.find((agent) => agent.id === id)?.name ?? id;
  if (event.type === 'alliance-proposed')
    return `${name(event.agentId)} proposed an alliance with ${name(event.recipientAgentId)}.`;
  if (event.type === 'alliance-formed')
    return `${event.memberAgentIds.map(name).join(' and ')} formed an alliance.`;
  if (event.type === 'agent-joined-alliance')
    return `${name(event.joinedAgentId)} joined the alliance.`;
  if (event.type === 'agent-left-alliance')
    return `${name(event.leftAgentId)} left the alliance.`;
  if (event.type === 'alliance-dissolved') return 'The alliance dissolved.';
  return `The proposal from ${name(event.proposerAgentId)} to ${name(event.recipientAgentId)} was ${event.reason}.`;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
