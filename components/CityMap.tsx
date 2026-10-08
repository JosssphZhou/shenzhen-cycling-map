'use client';

import { useEffect, useRef, useState } from 'react';
import type { CyclingRoute } from '@/lib/types';
import { CityEngine } from '@/scene/engine';

export interface CityMapProps {
  route: CyclingRoute | null;
  routes: CyclingRoute[];
  theme: 'light' | 'dark';
  timeOfDay: number;
  weather: '晴' | '雨' | '雾';
  paused: boolean;
  overviewKey: number;
  onSelect: (id: string) => void;
  onOverview?: () => void;
  onReady?: (stats: { roads: number; buildings: number }) => void;
}

export default function CityMap(props: CityMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<CityEngine | null>(null);
  const latest = useRef(props);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('正在打开深圳湾的微缩场景');
  const previousOverview = useRef(props.overviewKey);
  latest.current = props;

  useEffect(() => {
    let cancelled = false;
    let mounted: CityEngine | null = null;
    setStatus('loading'); setMessage('正在打开深圳湾的微缩场景');
    const fail = (message: string) => { if (!cancelled) { setStatus('error'); setMessage(message); } };
    const frame = requestAnimationFrame(() => {
      if (cancelled || !host.current) return;
      try {
        mounted = new CityEngine(host.current, id => latest.current.onSelect(id), fail);
        engine.current = mounted;
        mounted.setState(latest.current); mounted.setRoutes(latest.current.routes); mounted.select(latest.current.route);
        setStatus('ready'); latest.current.onReady?.(mounted.stats());
        if (new URLSearchParams(window.location.search).get('debug') === '1') {
          (window as unknown as { shenzhenMap?: { stats: () => unknown; overview: () => void } }).shenzhenMap = { stats: () => mounted?.stats(), overview: () => mounted?.overview() };
        }
      } catch (error) {
        console.error('深圳微缩场景加载失败', error);
        fail('这台设备暂时无法显示三维场景。你仍可在路线册中查看与导出路线。');
      }
    });
    return () => {
      cancelled = true; cancelAnimationFrame(frame); mounted?.dispose(); engine.current = null;
      delete (window as unknown as { shenzhenMap?: unknown }).shenzhenMap;
    };
  }, [attempt]);

  useEffect(() => { engine.current?.setState(props); }, [props.theme, props.timeOfDay, props.weather, props.paused]);
  useEffect(() => { engine.current?.setRoutes(props.routes); }, [props.routes]);
  useEffect(() => { engine.current?.select(props.route); }, [props.route]);
  useEffect(() => {
    if (previousOverview.current !== props.overviewKey) engine.current?.overview();
    previousOverview.current = props.overviewKey;
  }, [props.overviewKey]);

  return <div className="city-map" data-weather={props.weather} data-paused={props.paused} data-map-status={status}>
    <div ref={host} className="city-map-canvas" />
    {status !== 'ready' && <div className="city-map-state" role="status">
      <span className="city-state-cross">{status === 'loading' ? '＋' : '○'}</span>
      <p>{message}</p>
      {status === 'error' && <button onClick={() => setAttempt(value => value + 1)}>重新加载场景</button>}
      {status === 'loading' && <span className="city-loading-line" />}
    </div>}
    {status === 'ready' && <>
      <div className="city-compass" aria-label="北方朝向右上方"><span>北</span><i /></div>
      <div className="city-map-tools" aria-label="微缩场景视图">
        <button aria-label="靠近查看" title="靠近查看" onClick={() => engine.current?.zoomBy(1.7)}>＋</button>
        <button aria-label="拉远查看" title="拉远查看" onClick={() => engine.current?.zoomBy(1 / 1.7)}>−</button>
        <button aria-label="查看全城微缩场景" title="查看全城微缩场景" onClick={() => props.onOverview ? props.onOverview() : engine.current?.overview()}><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /><circle cx="10" cy="10" r="2.5" /></svg></button>
      </div>
      <div className="city-map-hint">拖动探索 · 点击地标靠近</div>
    </>}
    <style jsx>{`
      .city-map{position:absolute;inset:0;overflow:hidden;background:var(--panel,#f6f6f5);isolation:isolate;color:var(--ink,#6a6f73)}
      .city-map-canvas{position:absolute;inset:0}
      .city-map-state{position:absolute;top:43%;left:calc(50% + 150px);transform:translate(-50%,-50%);width:min(290px,70%);text-align:center;font-size:12px;line-height:1.9;z-index:5}
      .city-state-cross{font-size:38px;font-weight:200;line-height:1}
      .city-map-state p{margin:16px 0}.city-map-state button{border:1px solid var(--edge,#d6d8d8);padding:8px 14px;background:var(--panel,#f6f6f5);color:inherit;cursor:pointer;font:inherit}
      .city-loading-line{display:block;margin:22px auto 0;width:110px;height:1px;background:var(--edge,#d6d8d8);overflow:hidden}.city-loading-line:after{content:'';display:block;width:45%;height:100%;background:var(--ink,#6a6f73);animation:loading 1.4s ease-in-out infinite}
      .city-map-tools{position:absolute;right:22px;bottom:78px;display:flex;flex-direction:column;border:1px solid var(--edge,#d6d8d8);border-radius:5px;overflow:hidden;background:var(--panel,#f6f6f5);z-index:5}
      .city-map-tools button{display:grid;place-items:center;width:35px;height:35px;border:0;background:transparent;color:var(--ink-hi,#16181a);font-size:20px;cursor:pointer}.city-map-tools button+button{border-top:1px solid var(--edge,#d6d8d8)}.city-map-tools button:hover{background:var(--ground,#f0f0ef)}.city-map-tools button:focus-visible{outline:2px solid var(--ink-hi);outline-offset:-3px}
      .city-scale{position:absolute;right:22px;bottom:30px;font-size:10px;text-align:center;z-index:4}.city-scale i{display:block;height:5px;border:1px solid currentColor;border-top:0;margin-top:5px}
      .city-map-hint{position:absolute;bottom:28px;left:50%;font-size:10px;letter-spacing:.04em;opacity:.75;pointer-events:none;transform:translateX(-20%)}
      .city-compass{position:absolute;right:31px;top:95px;width:28px;height:48px;font-size:10px;text-align:center;pointer-events:none;z-index:4}.city-compass span{position:absolute;top:0;right:0}.city-compass i{position:absolute;top:17px;right:13px;height:24px;width:1px;background:currentColor;transform:rotate(60deg)}.city-compass i:before{content:'';position:absolute;top:0;left:-3px;width:6px;height:6px;border-left:1px solid currentColor;border-top:1px solid currentColor;transform:rotate(45deg)}
      .city-rain{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;opacity:.35}.city-rain i{position:absolute;top:-15%;height:55px;width:1px;background:linear-gradient(transparent,var(--ink,#6a6f73));animation:rain linear infinite;transform:rotate(18deg)}
      .city-map[data-paused="true"] .city-rain i{animation-play-state:paused}
      @keyframes rain{to{translate:-90px 950px}}@keyframes loading{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
      @media(max-width:799px){.city-map-state{left:50%;top:27%}.city-compass{right:20px;top:86px}.city-map-tools{right:15px;bottom:75px}.city-scale{right:15px;bottom:29px}.city-map-hint{left:16px;bottom:30px;transform:none;font-size:9px}}
      @media(max-width:700px){.city-compass{display:none}:global(.stage.with-panel) .city-map-tools{bottom:calc(54% + 35px)}:global(.stage.with-panel) .city-scale{bottom:calc(54% + 6px)}:global(.stage.with-panel) .city-map-hint{display:none}}
      @media(prefers-reduced-motion:reduce){.city-rain{display:none}.city-loading-line:after{animation:none}}
    `}</style>
  </div>;
}
