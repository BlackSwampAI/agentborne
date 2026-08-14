'use client';

import { useEffect, useRef, useState } from 'react';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import {
  AttributionControl,
  LngLatBounds,
  type GeoJSONSource,
  Map,
  type MapLayerMouseEvent,
  type MapSourceDataEvent,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import type {
  AgentId,
  AgentProfile,
  H3Cell,
  HexState,
} from '@agentborne/shared';

interface WorldMapProps {
  latitude: number;
  longitude: number;
  hexes: Array<{ cell: H3Cell; state: HexState }>;
  agents: AgentProfile[];
  selectedCell: H3Cell;
  selectedAgentId: AgentId | null;
  onSelectCell: (cell: H3Cell) => void;
  onSelectAgent: (agentId: AgentId) => void;
}

const sourceId = 'development-hexes';
const fillLayerId = 'development-hex-fills';
const lineLayerId = 'development-hex-lines';
const expectedWorldCellCount = 61;

setWorkerUrl('/maplibre-worker/maplibre-gl-worker.mjs');

type OverlayStatus = 'initializing' | 'ready' | 'incomplete' | 'failed';

interface OverlayDiagnostics {
  status: OverlayStatus;
  renderedCellCount: number;
  renderedInfectedCellCount: number;
  detail: string;
}

const initialOverlayDiagnostics: OverlayDiagnostics = {
  status: 'initializing',
  renderedCellCount: 0,
  renderedInfectedCellCount: 0,
  detail: 'Waiting for the H3 source and layers to render.',
};

function asGeoJson(hexes: WorldMapProps['hexes'], selectedCell: H3Cell) {
  return {
    type: 'FeatureCollection' as const,
    features: hexes.map(({ cell, state }) => ({
      type: 'Feature' as const,
      properties: { cell, state, selected: cell === selectedCell },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [closedBoundary(cell)],
      },
    })),
  };
}

function closedBoundary(cell: H3Cell): number[][] {
  const coordinates = cellToBoundary(cell).map(([lat, lng]) => [lng, lat]);
  const first = coordinates[0];
  return first ? [...coordinates, first] : coordinates;
}

export function WorldMap(props: WorldMapProps) {
  const {
    latitude,
    longitude,
    hexes,
    agents,
    selectedCell,
    selectedAgentId,
    onSelectCell,
    onSelectAgent,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onSelectCellRef = useRef(onSelectCell);
  const onSelectAgentRef = useRef(onSelectAgent);
  const initialHexes = useRef(hexes);
  const initialSelectedCell = useRef(selectedCell);
  const currentHexesRef = useRef(hexes);
  const scheduleOverlayInspectionRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [overlayDiagnostics, setOverlayDiagnostics] = useState(
    initialOverlayDiagnostics,
  );

  useEffect(() => {
    currentHexesRef.current = hexes;
  }, [hexes]);

  useEffect(() => {
    onSelectCellRef.current = onSelectCell;
    onSelectAgentRef.current = onSelectAgent;
  }, [onSelectAgent, onSelectCell]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new Map({
      container: containerRef.current,
      center: [longitude, latitude],
      zoom: 13,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          'osm-development': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          { id: 'osm-development', type: 'raster', source: 'osm-development' },
        ],
      },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }));
    const inspectOverlay = () => {
      if (
        !map.getSource(sourceId) ||
        !map.getLayer(fillLayerId) ||
        !map.getLayer(lineLayerId)
      ) {
        setOverlayDiagnostics({
          status: 'failed',
          renderedCellCount: 0,
          renderedInfectedCellCount: 0,
          detail: 'MapLibre rejected the H3 source or one of its layers.',
        });
        return;
      }

      if (!map.isSourceLoaded(sourceId)) {
        return;
      }

      try {
        const expectedCells = new Set(
          currentHexesRef.current.map(({ cell }) => cell),
        );
        const renderedCells = new globalThis.Map<H3Cell, HexState>();
        for (const feature of map.queryRenderedFeatures({
          layers: [fillLayerId],
        })) {
          const cell = feature.properties?.cell;
          const state = feature.properties?.state;
          if (
            typeof cell === 'string' &&
            (state === 'open' || state === 'infected')
          ) {
            renderedCells.set(cell as H3Cell, state);
          }
        }
        const renderedCellCount = renderedCells.size;
        const renderedInfectedCellCount = [...renderedCells.values()].filter(
          (state) => state === 'infected',
        ).length;
        const ready =
          expectedCells.size === expectedWorldCellCount &&
          renderedCellCount === expectedWorldCellCount &&
          [...expectedCells].every((cell) => renderedCells.has(cell));
        setOverlayDiagnostics({
          status: ready ? 'ready' : 'incomplete',
          renderedCellCount,
          renderedInfectedCellCount,
          detail: ready
            ? 'All expected H3 cells were returned by MapLibre.'
            : `MapLibre rendered ${renderedCellCount} of ${expectedWorldCellCount} expected H3 cells.`,
        });
      } catch {
        setOverlayDiagnostics({
          status: 'failed',
          renderedCellCount: 0,
          renderedInfectedCellCount: 0,
          detail: 'MapLibre could not inspect the rendered H3 layer.',
        });
      }
    };
    let inspectionPending = false;
    const inspectAfterRender = () => {
      if (!inspectionPending) return;
      if (
        !map.getSource(sourceId) ||
        !map.getLayer(fillLayerId) ||
        !map.getLayer(lineLayerId)
      ) {
        inspectionPending = false;
        inspectOverlay();
        return;
      }
      if (!map.isSourceLoaded(sourceId)) return;
      inspectionPending = false;
      inspectOverlay();
    };
    const scheduleOverlayInspection = () => {
      inspectionPending = true;
      map.triggerRepaint();
    };
    const inspectLoadedH3Source = (event: MapSourceDataEvent) => {
      if (event.sourceId === sourceId && inspectionPending) {
        map.triggerRepaint();
      }
    };
    const selectRenderedCell = (event: MapLayerMouseEvent) => {
      const cell = event.features?.[0]?.properties?.cell;
      if (typeof cell === 'string') onSelectCellRef.current(cell as H3Cell);
    };
    const showCellCursor = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearCellCursor = () => {
      map.getCanvas().style.cursor = '';
    };
    const initializeOverlay = () => {
      try {
        map.addSource(sourceId, {
          type: 'geojson',
          data: asGeoJson(initialHexes.current, initialSelectedCell.current),
        });
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': [
              'match',
              ['get', 'state'],
              'infected',
              '#e44f45',
              '#4a8178',
            ],
            'fill-opacity': [
              'case',
              ['boolean', ['get', 'selected'], false],
              0.72,
              0.38,
            ],
          },
        });
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': [
              'case',
              ['boolean', ['get', 'selected'], false],
              '#fff2c9',
              '#b8d4cc',
            ],
            'line-opacity': 0.95,
            'line-width': [
              'case',
              ['boolean', ['get', 'selected'], false],
              4,
              1.25,
            ],
          },
        });
        map.on('click', fillLayerId, selectRenderedCell);
        map.on('mouseenter', fillLayerId, showCellCursor);
        map.on('mouseleave', fillLayerId, clearCellCursor);

        const bounds = new LngLatBounds();
        for (const { cell } of initialHexes.current) {
          for (const [lat, lng] of cellToBoundary(cell)) {
            bounds.extend([lng, lat]);
          }
        }
        map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 });
        scheduleOverlayInspectionRef.current = scheduleOverlayInspection;
        scheduleOverlayInspection();
      } catch {
        setOverlayDiagnostics({
          status: 'failed',
          renderedCellCount: 0,
          renderedInfectedCellCount: 0,
          detail: 'MapLibre rejected the H3 source or layer configuration.',
        });
      } finally {
        setMapReady(true);
      }
    };

    map.on('sourcedata', inspectLoadedH3Source);
    map.on('render', inspectAfterRender);
    map.on('load', initializeOverlay);

    return () => {
      scheduleOverlayInspectionRef.current = null;
      map.off('load', initializeOverlay);
      map.off('sourcedata', inspectLoadedH3Source);
      map.off('render', inspectAfterRender);
      map.off('click', fillLayerId, selectRenderedCell);
      map.off('mouseenter', fillLayerId, showCellCursor);
      map.off('mouseleave', fillLayerId, clearCellCursor);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  useEffect(() => {
    const source = mapRef.current?.getSource(sourceId) as
      GeoJSONSource | undefined;
    if (!source) return;
    source.setData(asGeoJson(hexes, selectedCell));
    scheduleOverlayInspectionRef.current?.();
  }, [hexes, selectedCell]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const grouped = new globalThis.Map<H3Cell, AgentProfile[]>();
    for (const agent of agents) {
      grouped.set(agent.currentCell, [
        ...(grouped.get(agent.currentCell) ?? []),
        agent,
      ]);
    }
    for (const agent of agents) {
      const cellmates = grouped
        .get(agent.currentCell)!
        .toSorted((a, b) => a.id.localeCompare(b.id));
      const position = cellmates.findIndex(({ id }) => id === agent.id);
      const angle = (position / Math.max(cellmates.length, 1)) * Math.PI * 2;
      const distance = cellmates.length > 1 ? 15 : 0;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `agent-marker${agent.id === selectedAgentId ? ' selected' : ''}`;
      element.dataset.agentId = agent.id;
      element.setAttribute('aria-label', `Select agent ${agent.name}`);
      element.title = `${agent.name} · ${agent.currentCell}`;
      element.style.setProperty('--agent-color', agent.color);
      element.textContent = agent.name.slice(0, 1);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelectAgentRef.current(agent.id);
      });
      const [lat, lng] = cellToLatLng(agent.currentCell);
      const marker = new Marker({
        element,
        offset: [Math.cos(angle) * distance, Math.sin(angle) * distance],
      })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [agents, mapReady, selectedAgentId]);

  const overlayReady = overlayDiagnostics.status === 'ready';
  const overlayLabel = overlayReady
    ? 'ready'
    : overlayDiagnostics.status === 'initializing'
      ? 'initializing'
      : overlayDiagnostics.status;

  return (
    <div className="map-stage">
      <div
        className="world-map"
        data-overlay-status={overlayDiagnostics.status}
        data-rendered-h3-cell-count={overlayDiagnostics.renderedCellCount}
        data-rendered-infected-cell-count={
          overlayDiagnostics.renderedInfectedCellCount
        }
        data-testid="world-map"
        ref={containerRef}
      />
      <p className="map-ready" role="status" title={overlayDiagnostics.detail}>
        H3 overlay {overlayLabel} · {overlayDiagnostics.renderedCellCount}/
        {expectedWorldCellCount} rendered cells · {agents.length} agents ·{' '}
        <span data-testid="infected-count">
          {overlayDiagnostics.renderedInfectedCellCount} rendered infected
        </span>
      </p>
    </div>
  );
}
