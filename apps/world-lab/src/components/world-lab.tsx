'use client';

import { useMemo, useState } from 'react';
import { createDevelopmentWorld } from '@agentborne/world-engine';
import type { H3Cell } from '@agentborne/shared';
import { WorldMap } from './world-map';

const latitude = Number(process.env.NEXT_PUBLIC_DEV_MAP_LATITUDE ?? 41.6528);
const longitude = Number(process.env.NEXT_PUBLIC_DEV_MAP_LONGITUDE ?? -83.5379);
const resolution = Number(process.env.NEXT_PUBLIC_DEV_MAP_H3_RESOLUTION ?? 9);

export function WorldLab() {
  const world = useMemo(
    () => createDevelopmentWorld({ latitude, longitude, resolution }),
    [],
  );
  const [selectedCell, setSelectedCell] = useState<H3Cell>(
    world.hexes[0]!.cell,
  );
  const selectedHex = world.hexes.find(({ cell }) => cell === selectedCell)!;

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Developer simulation interface</p>
          <h1>World Lab</h1>
        </div>
        <p className="status">
          <span aria-hidden="true" /> Foundation world · paused
        </p>
      </header>

      <div className="workspace">
        <section className="map-panel" aria-label="Development world map">
          <WorldMap
            latitude={latitude}
            longitude={longitude}
            hexes={world.hexes}
            selectedCell={selectedCell}
            onSelect={setSelectedCell}
          />
          <div className="map-caption">
            <span>Development location: Toledo, Ohio</span>
            <span>
              H3 resolution {resolution} · {world.hexes.length} cells
            </span>
          </div>
        </section>

        <aside className="sidebar">
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
            <div className="hex-list" aria-label="Select a hex">
              {world.hexes.map((hex, index) => (
                <button
                  aria-label={`Select hex ${index + 1}`}
                  aria-pressed={hex.cell === selectedCell}
                  className={hex.state}
                  key={hex.cell}
                  onClick={() => setSelectedCell(hex.cell)}
                  title={hex.cell}
                  type="button"
                />
              ))}
            </div>
          </section>

          <section className="panel reserved-panel">
            <p className="panel-kicker">Reserved for PR 2</p>
            <h2>Simulation controls</h2>
            <div className="control-row">
              <button disabled type="button">
                Start
              </button>
              <button disabled type="button">
                Single turn
              </button>
              <button disabled type="button">
                Reset
              </button>
            </div>
            <p>
              Agent turns and playback arrive with the first model-backed
              invasion.
            </p>
          </section>

          <section className="panel reserved-panel">
            <p className="panel-kicker">Reserved for PR 2</p>
            <h2>Agent inspector</h2>
            <p>No agents are running in the foundation world.</p>
          </section>

          <section className="panel event-panel">
            <p className="panel-kicker">World events</p>
            <h2>Event log</h2>
            <ol aria-label="World event log">
              <li>
                <time>Initial</time>
                <span>Development world loaded.</span>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
