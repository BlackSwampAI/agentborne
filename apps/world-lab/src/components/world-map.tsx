'use client';

import { useEffect, useRef } from 'react';
import { cellToBoundary } from 'h3-js';
import {
  AttributionControl,
  type GeoJSONSource,
  Map,
  NavigationControl,
} from 'maplibre-gl';
import type { H3Cell, HexState } from '@agentborne/shared';

interface WorldMapProps {
  latitude: number;
  longitude: number;
  hexes: Array<{ cell: H3Cell; state: HexState }>;
  selectedCell: H3Cell;
  onSelect: (cell: H3Cell) => void;
}

const sourceId = 'development-hexes';
const fillLayerId = 'development-hex-fills';

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

export function WorldMap({
  latitude,
  longitude,
  hexes,
  selectedCell,
  onSelect,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const initialSelectedCell = useRef(selectedCell);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      center: [longitude, latitude],
      zoom: 14,
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
        data: asGeoJson(hexes, initialSelectedCell.current),
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
            '#d45749',
            '#4f7b75',
          ],
          'fill-opacity': ['case', ['get', 'selected'], 0.76, 0.4],
          'fill-outline-color': [
            'case',
            ['get', 'selected'],
            '#f6e8c9',
            '#d8dfd8',
          ],
        },
      });
      map.on('click', fillLayerId, (event) => {
        const cell = event.features?.[0]?.properties?.cell;
        if (typeof cell === 'string') onSelectRef.current(cell as H3Cell);
      });
      map.on('mouseenter', fillLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', fillLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [hexes, latitude, longitude]);

  useEffect(() => {
    const source = mapRef.current?.getSource(sourceId) as
      GeoJSONSource | undefined;
    source?.setData(asGeoJson(hexes, selectedCell));
  }, [hexes, selectedCell]);

  return (
    <div className="world-map" data-testid="world-map" ref={containerRef} />
  );
}
