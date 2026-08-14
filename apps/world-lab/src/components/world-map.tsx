'use client';

import { useEffect, useRef, useState } from 'react';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import {
  AttributionControl,
  LngLatBounds,
  type GeoJSONSource,
  Map,
  Marker,
  NavigationControl,
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
  const [overlayReady, setOverlayReady] = useState(false);

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

    map.on('load', () => {
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
          'fill-opacity': ['case', ['get', 'selected'], 0.72, 0.38],
        },
      });
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': [
            'case',
            ['get', 'selected'],
            '#fff2c9',
            '#b8d4cc',
          ],
          'line-opacity': 0.95,
          'line-width': ['case', ['get', 'selected'], 4, 1.25],
        },
      });
      map.on('click', fillLayerId, (event) => {
        const cell = event.features?.[0]?.properties?.cell;
        if (typeof cell === 'string')
          onSelectCellRef.current(cell as H3Cell);
      });
      map.on('mouseenter', fillLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', fillLayerId, () => {
        map.getCanvas().style.cursor = '';
      });

      const bounds = new LngLatBounds();
      for (const { cell } of initialHexes.current) {
        for (const [lat, lng] of cellToBoundary(cell)) bounds.extend([lng, lat]);
      }
      map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 });
      setOverlayReady(true);
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  useEffect(() => {
    const source = mapRef.current?.getSource(sourceId) as
      | GeoJSONSource
      | undefined;
    source?.setData(asGeoJson(hexes, selectedCell));
  }, [hexes, selectedCell]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !overlayReady) return;
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
  }, [agents, overlayReady, selectedAgentId]);

  return (
    <div className="map-stage">
      <div className="world-map" data-testid="world-map" ref={containerRef} />
      <p className="map-ready" role="status">
        H3 overlay {overlayReady ? 'ready' : 'initializing'} · {hexes.length}{' '}
        cells · {agents.length} agents ·{' '}
        <span data-testid="infected-count">
          {hexes.filter(({ state }) => state === 'infected').length} infected
        </span>
      </p>
    </div>
  );
}
