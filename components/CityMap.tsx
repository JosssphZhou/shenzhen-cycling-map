'use client';

import { useEffect, useRef } from 'react';
import type { CyclingRoute } from '@/lib/types';
import type { SceneController, SceneSnapshot } from '@/scene/contract';
import { CityEngine } from '@/scene/engine';

export interface CityMapProps {
  routes: CyclingRoute[];
  onController: (controller: SceneController | null) => void;
  onSnapshot: (snapshot: SceneSnapshot) => void;
}

export default function CityMap(props: CityMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CityEngine | null>(null);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    let cancelled = false, mounted: CityEngine | null = null;
    const frame = requestAnimationFrame(() => {
      if (cancelled || !canvas.current) return;
      const stage = canvas.current.closest<HTMLElement>('#stage'); if (!stage) return;
      try {
        mounted = new CityEngine(canvas.current, stage, snapshot => latest.current.onSnapshot(snapshot));
        mounted.setRoutes(latest.current.routes); engine.current = mounted; latest.current.onController(mounted);
        if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { shenzhenMap?: unknown }).shenzhenMap = mounted.debug();
      } catch (error) {
        mounted?.dispose(); mounted = null; engine.current = null;
        console.error('深圳微缩场景加载失败', error);
        const note = stage.querySelector<HTMLElement>('#note');
        if (note) { note.hidden = false; note.textContent = '这台设备暂时无法显示三维场景。仍可从路线册查看与导出路线。'; }
      }
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); mounted?.dispose(); engine.current = null; latest.current.onController(null); delete (window as unknown as { shenzhenMap?: unknown }).shenzhenMap; };
  }, []);
  useEffect(() => { engine.current?.setRoutes(props.routes); }, [props.routes]);
  return <>
    <canvas ref={canvas} id="view" tabIndex={0} role="img" aria-label="深圳地标微缩城市。拖动平移，滚轮或双指缩放，点击对象查看详情。空格暂停，F跟随，T切换主题，N快进六小时。" />
    <div className="tag hover" id="tagHover" hidden />
    <div className="tag" id="tagSel" hidden />
    <div className="tag stop" id="tagStop" hidden />
    <p className="note" id="note" hidden />
  </>;
}
