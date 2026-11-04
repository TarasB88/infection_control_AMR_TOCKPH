import { useMemo, useState } from 'react';
import { DISTRICT_SHAPES, type DistrictShape } from '../lib/map-shapes';
import { COMMUNITY_SHAPES } from '../lib/community-shapes';

export type AmrAreaStat = { name: string; total: number; samples: number; resistant: number };

const ALL = 'all';
type Mode = 'districts' | 'communities';

function buildPaths(shapes: DistrictShape[], width: number, height: number) {
  if (!shapes.length) return [];
  const points = shapes.flatMap((shape) => shape.rings.flat());
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minX = Math.min(...lons), maxX = Math.max(...lons);
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const cosLat = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const scale = Math.min((width - 24) / ((maxX - minX) * cosLat), (height - 24) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * cosLat * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const x = (lon: number) => offsetX + (lon - minX) * cosLat * scale;
  const y = (lat: number) => offsetY + (maxY - lat) * scale;
  return shapes.map((shape) => ({
    name: shape.name,
    d: shape.rings.map((ring) => ring.map((point, index) => `${index ? 'L' : 'M'}${x(point[0]).toFixed(1)},${y(point[1]).toFixed(1)}`).join('') + 'Z').join(' '),
    cx: x(shape.rings[0].reduce((sum, point) => sum + point[0], 0) / shape.rings[0].length),
    cy: y(shape.rings[0].reduce((sum, point) => sum + point[1], 0) / shape.rings[0].length),
  }));
}

export function AmrMap({
  districtStats, selectedDistrict, onSelectDistrict,
  communityStats, selectedCommunity, onSelectCommunity,
}: {
  districtStats: AmrAreaStat[];
  selectedDistrict: string;
  onSelectDistrict: (name: string) => void;
  communityStats: AmrAreaStat[];
  selectedCommunity: string;
  onSelectCommunity: (name: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('districts');
  const [hovered, setHovered] = useState<string | null>(null);
  const width = 420, height = 520;
  const isCommunity = mode === 'communities';
  const shapes = isCommunity ? COMMUNITY_SHAPES : DISTRICT_SHAPES;
  const paths = useMemo(() => buildPaths(shapes, width, height), [shapes]);
  const stats = isCommunity ? communityStats : districtStats;
  const selected = isCommunity ? selectedCommunity : selectedDistrict;
  const select = isCommunity ? onSelectCommunity : onSelectDistrict;
  const maximum = Math.max(1, ...stats.map((item) => item.total));
  const getStat = (name: string) => stats.find((item) => item.name === name);
  const active = (hovered && getStat(hovered)) || (selected !== ALL ? getStat(selected) : null);

  const fillFor = (value: number) => {
    if (!value) return '#edf2f4';
    const opacity = 0.16 + (value / maximum) * 0.68;
    return `rgba(8, 133, 139, ${opacity.toFixed(2)})`;
  };

  return (
    <div className="amr-map">
      <div className="amr-map-toggle" role="group" aria-label="Рівень карти">
        <button className={mode === 'districts' ? 'active' : ''} onClick={() => { setMode('districts'); setHovered(null); }}>Райони</button>
        <button className={mode === 'communities' ? 'active' : ''} onClick={() => { setMode('communities'); setHovered(null); }}>Громади</button>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={isCommunity ? 'Карта громад Тернопільської області' : 'Карта районів Тернопільської області'}>
        {paths.map((path) => {
          const stat = getStat(path.name);
          const isSelected = selected === path.name;
          const isHovered = hovered === path.name;
          return (
            <g key={path.name}>
              <path
                d={path.d}
                fill={fillFor(stat?.total ?? 0)}
                stroke={isSelected || isHovered ? '#087f87' : '#cbd7dc'}
                strokeWidth={isSelected || isHovered ? 3 : 1.1}
                className="amr-map-area"
                onMouseEnter={() => setHovered(path.name)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => select(isSelected ? ALL : path.name)}
              >
                <title>{path.name}: {stat?.total ?? 0} результатів AST</title>
              </path>
              {!isCommunity && (
                <>
                  <text x={path.cx} y={path.cy - 5} textAnchor="middle" className="amr-map-label">{path.name.replace(' район', '')}</text>
                  <text x={path.cx} y={path.cy + 12} textAnchor="middle" className="amr-map-value">{stat?.total ?? 0}</text>
                </>
              )}
              {isCommunity && (stat?.total ?? 0) > 0 && (
                <text x={path.cx} y={path.cy + 3} textAnchor="middle" className="amr-map-value">{stat?.total}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="amr-map-detail" aria-live="polite">
        {active ? (
          <>
            <b>{active.name}</b>
            <span>Результати AST: <strong>{active.total}</strong></span>
            <span>Унікальні зразки: <strong>{active.samples}</strong></span>
            <span>Категорія R: <strong>{active.resistant}</strong></span>
          </>
        ) : (
          <span>Наведіть курсор для перегляду показників або натисніть на територію, щоб відфільтрувати таблицю.</span>
        )}
      </div>
      {selected !== ALL && <button className="amr-map-reset" onClick={() => select(ALL)}>Скинути вибір території</button>}
      <div className="amr-map-legend"><span>Менше</span><i/><i/><i/><i/><span>Більше результатів AST</span></div>
      <p className="amr-map-note">Карта відображає кількість рядків AST у поточній вибірці. Один зразок може містити декілька результатів для різних препаратів.</p>
    </div>
  );
}
