'use client';

import { useEffect, useRef, useState } from 'react';
import type { CyclingRoute } from '@/lib/types';
import type { SceneController, SceneSnapshot } from '@/scene/contract';
import type { ShenzhenMapData } from '@/scene/map-types';
import { CityEngine } from '@/scene/engine';

export interface CityMapProps {
  routes: CyclingRoute[];
  onController: (controller: SceneController | null) => void;
  onSnapshot: (snapshot: SceneSnapshot) => void;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const coordinate = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && Number.isFinite(item));
const points = (value: unknown, minimum: number): boolean => Array.isArray(value) && value.length >= minimum && value.every(coordinate);
const rings = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(ring => points(ring, 3));
const geoBounds = (value: unknown): boolean => Array.isArray(value) && value.length === 4 && value.every(item => typeof item === 'number' && Number.isFinite(item)) && value[0] < value[2] && value[1] < value[3];
function validMap(value: unknown): value is ShenzhenMapData {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.bounds) || value.bounds.length !== 4 || !value.bounds.every(item => typeof item === 'number' && Number.isFinite(item))) return false;
  if (!(value.bounds[0] < value.bounds[2] && value.bounds[1] < value.bounds[3]) || !coordinate(value.center)) return false;
  for (const key of ['land', 'water']) if (!Array.isArray(value[key]) || !value[key].every(item => record(item) && typeof item.id === 'string' && typeof item.kind === 'string' && rings(item.rings))) return false;
  if (!Array.isArray(value.roads) || !value.roads.every(item => record(item) && typeof item.id === 'string' && typeof item.kind === 'string' && points(item.points, 2))) return false;
  if (!Array.isArray(value.districts) || !value.districts.every(item => record(item) && typeof item.name === 'string' && coordinate(item.center) && rings(item.rings))) return false;
  if (!Array.isArray(value.landmarks) || !value.landmarks.every(item => record(item) && typeof item.id === 'string' && typeof item.name === 'string' && ['spring-bamboo', 'cocoon', 'pingan', 'civic-center', 'kk100'].includes(String(item.model)) && coordinate(item.coordinate) && rings(item.rings) && (item.height === undefined || typeof item.height === 'number' && Number.isFinite(item.height)))) return false;
  if (!Array.isArray(value.buildings) || !value.buildings.every(item => record(item) && typeof item.id === 'string' && rings(item.rings) && ['height', 'minHeight'].every(key => item[key] === undefined || typeof item[key] === 'number' && Number.isFinite(item[key])))) return false;
  const terrain = value.terrain;
  if (!record(terrain) || !geoBounds(terrain.bounds) || !Number.isInteger(terrain.width) || !Number.isInteger(terrain.height) || Number(terrain.width) < 2 || Number(terrain.height) < 2 || !Array.isArray(terrain.values) || terrain.values.length !== Number(terrain.width) * Number(terrain.height) || !terrain.values.every(item => typeof item === 'number' && Number.isFinite(item))) return false;
  if (!Array.isArray(value.buildingTiles) || !value.buildingTiles.every(item => record(item) && typeof item.id === 'string' && typeof item.url === 'string' && item.url.startsWith('/data/tiles/') && !item.url.includes('..') && geoBounds(item.bounds) && Number.isInteger(item.count) && Number(item.count) >= 0)) return false;
  return Array.isArray(value.sources) && typeof value.generated === 'string' && record(value.statistics);
}

export default function CityMap(props: CityMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CityEngine | null>(null);
  const requests = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    let cancelled = false, mounted: CityEngine | null = null;
    const abort = new AbortController();
    const stage = canvas.current?.closest<HTMLElement>('#stage'); if (!stage) return;
    const note = stage.querySelector<HTMLElement>('#note');
    if (note) { note.hidden = false; note.textContent = '正在载入深圳地图…'; }
    const start = async () => {
      try {
        requests.current++;
        const response = await fetch('/data/shenzhen-city.json', { signal: abort.signal });
        if (!response.ok) throw new Error(`地图请求失败：${response.status}`);
        const bytes = await response.arrayBuffer();
        const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!validMap(data)) throw new Error('地图数据格式不完整');
        if (cancelled || !canvas.current) return;
        // 与上游 yard/index.ts 一样，先等文字纹理使用的字体；超时仍可继续显示地图。
        await Promise.race([
          document.fonts.load(`500 64px ${getComputedStyle(document.documentElement).getPropertyValue('--mono').trim()}`),
          new Promise(resolve => setTimeout(resolve, 2500)),
        ]).catch(() => {});
        if (cancelled || abort.signal.aborted || !canvas.current) return;
        mounted = new CityEngine(canvas.current, stage, snapshot => latest.current.onSnapshot(snapshot), data, latest.current.routes, { requests: requests.current, bytes: bytes.byteLength });
        engine.current = mounted; latest.current.onController(mounted);
        if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { shenzhenMap?: unknown }).shenzhenMap = mounted.debug();
      } catch (error) {
        if (cancelled || abort.signal.aborted) return;
        mounted?.dispose(); mounted = null; engine.current = null; latest.current.onController(null);
        console.error('深圳地图加载失败', error);
        if (note) {
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新载入'; retry.onclick = () => setAttempt(value => value + 1);
          note.hidden = false; note.replaceChildren(document.createTextNode('地图暂时无法载入，仍可从路线集查看与导出路线。'), document.createElement('br'), retry);
        }
      }
    };
    void start();
    return () => { cancelled = true; abort.abort(); mounted?.dispose(); engine.current = null; latest.current.onController(null); delete (window as unknown as { shenzhenMap?: unknown }).shenzhenMap; };
  }, [attempt]);
  useEffect(() => { engine.current?.setRoutes(props.routes); }, [props.routes]);
  return <canvas ref={canvas} id="view" tabIndex={0} role="img" aria-label="深圳真实三维骑行地图。拖动平移，滚轮或双指缩放，点击对象查看详情。空格暂停，F跟随，T切换主题，N快进六小时。" />;
}
