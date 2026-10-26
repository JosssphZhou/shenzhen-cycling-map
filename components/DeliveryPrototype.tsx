'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SelectionCard, { type CardAction, type CardRow } from './SelectionCard';
import { INITIAL_SNAPSHOT, type SceneController, type SceneSnapshot } from '@/scene/contract';
import {
  DELIVERY_UPGRADES, STORAGE_KEYS, buyUpgrade, createProfile, idleScene, loadProfile,
  parseNetwork, planShift, readShift, settleShift, transactProfile,
  type DeliveryMode, type DeliveryNetwork, type DeliveryProfile, type DeliveryReceipt,
  type OrderPhase,
} from '@/lib/delivery/model';
import type { DeliverySceneState } from '@/lib/delivery/scene-contract';
import copy from './delivery-copy.json';
import './delivery-prototype.css';

const CityMap = dynamic(() => import('./CityMap'), { ssr: false });
const MAP_ROUTES: [] = [];
type Pane = 'delivery' | 'orders' | 'my' | 'explore' | 'receipt' | 'early';
type StoreState = { kind: 'loading' } | { kind: 'invalid'; message: string } | { kind: 'ready'; profile: DeliveryProfile; persistence: 'local' | 'memory'; notice: string };
type NetworkState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; network: DeliveryNetwork };
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const distance = (meters: number) => `${(meters / 1000).toFixed(1)} 公里`;
const clock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const phaseNames: Record<OrderPhase, string> = { queued: '待配送', 'to-pickup': '前往取餐', waiting: '正在等餐', 'to-dropoff': '配送中', delivered: '已送达', cancelled: '已取消' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作暂时没有完成，请稍后重试。';

/** 可丢弃的配送玩法原型；真实城市绘制器只接收当前配送画面。 */
export default function DeliveryPrototype() {
  const controller = useRef<SceneController | null>(null);
  const card = useRef<HTMLElement>(null);
  const currentProfile = useRef<DeliveryProfile | null>(null);
  const currentScene = useRef<DeliverySceneState | null>(null);
  const busyRef = useRef(false);
  const settledAttempt = useRef('');
  const [store, setStore] = useState<StoreState>({ kind: 'loading' });
  const [networkState, setNetworkState] = useState<NetworkState>({ kind: 'loading' });
  const [networkAttempt, setNetworkAttempt] = useState(0);
  const [mode, setMode] = useState<DeliveryMode>('focus');
  const [pane, setPane] = useState<Pane>('delivery');
  const [cardVisible, setCardVisible] = useState(true);
  const [minutes, setMinutes] = useState('45');
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<DeliveryReceipt | null>(null);
  const [snapshot, setSnapshot] = useState<SceneSnapshot>(INITIAL_SNAPSHOT);
  const profile = store.kind === 'ready' ? store.profile : null;
  const shift = profile?.activeShift ?? null;
  const progress = useMemo(() => shift ? readShift({ shift, now }) : null, [shift, now]);
  const sceneState = useMemo(() => progress?.scene ?? (profile ? idleScene(profile) : null), [progress, profile]);
  currentScene.current = sceneState;

  const acceptProfile = useCallback((value: DeliveryProfile, persistence: 'local' | 'memory', notice = '') => {
    currentProfile.current = value;
    setStore({ kind: 'ready', profile: value, persistence, notice });
  }, []);

  const readStore = useCallback((selectedMode: DeliveryMode) => {
    try {
      const loaded = loadProfile(selectedMode);
      if (loaded.kind === 'invalid') {
        currentProfile.current = null;
        setStore({ kind: 'invalid', message: loaded.message });
        return;
      }
      acceptProfile(loaded.kind === 'ok' ? loaded.profile : createProfile(selectedMode), 'local');
    } catch {
      const previous = currentProfile.current;
      acceptProfile(previous?.mode === selectedMode ? previous : createProfile(selectedMode), 'memory', '浏览器暂时无法保存。当前仅临时体验，关闭页面后无法恢复。');
    }
    setNow(Date.now());
  }, [acceptProfile]);

  useEffect(() => {
    const initialMode = new URLSearchParams(location.search).get('mode') === 'demo' ? 'demo' : 'focus';
    setMode(initialMode);
    readStore(initialMode);
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [readStore]);

  useEffect(() => {
    const abort = new AbortController();
    setNetworkState({ kind: 'loading' });
    void fetch('/data/delivery-network.json', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('配送路网暂时没有载入，请重试。');
      const raw: unknown = await response.json();
      const network = parseNetwork(raw);
      if (!abort.signal.aborted) setNetworkState({ kind: 'ready', network });
    }).catch(error => {
      if (!abort.signal.aborted) setNetworkState({ kind: 'error', message: errorMessage(error) });
    });
    return () => abort.abort();
  }, [networkAttempt]);

  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') readStore(mode); };
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEYS[mode]) readStore(mode); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('storage', sync);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('storage', sync);
    };
  }, [mode, readStore]);

  const mutate = useCallback(async (change: (fresh: DeliveryProfile) => DeliveryProfile) => {
    if (busyRef.current || store.kind !== 'ready') return null;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const next = store.persistence === 'memory'
        ? change(currentProfile.current ?? createProfile(mode))
        : await transactProfile({ mode, change });
      acceptProfile(next, store.persistence, store.notice);
      setNow(Date.now());
      return next;
    } catch (error) {
      setMessage(errorMessage(error));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [acceptProfile, mode, store]);

  useEffect(() => {
    if (!shift || progress?.phase !== 'finished' || busyRef.current || settledAttempt.current === shift.id) return;
    const shiftId = shift.id;
    settledAttempt.current = shiftId;
    void mutate(fresh => settleShift({ profile: fresh, now: Date.now() }).profile).then(next => {
      if (!next) { settledAttempt.current = ''; return; }
      const finished = next.receipts.find(item => item.id === shiftId);
      if (finished) {
        setReceipt(finished);
        setPane('receipt');
        setCardVisible(true);
      }
    });
  }, [shift, progress?.phase, mutate]);

  useEffect(() => {
    controller.current?.setDelivery(sceneState);
  }, [sceneState]);

  const onController = useCallback((value: SceneController | null) => {
    controller.current = value;
    if (value && currentScene.current) {
      value.setDelivery(currentScene.current);
      value.focusDelivery();
      value.followDelivery();
    }
  }, []);
  const onSnapshot = useCallback((value: SceneSnapshot) => setSnapshot(value), []);

  function openPane(next: Pane) {
    setPane(next);
    setCardVisible(true);
    setMessage('');
    requestAnimationFrame(() => card.current?.scrollTo({ top: 0 }));
  }

  function selectMode(next: DeliveryMode) {
    if (busyRef.current || next === mode) return;
    setMode(next);
    setPane('delivery');
    setCardVisible(true);
    setReceipt(null);
    setMessage('');
    settledAttempt.current = '';
    readStore(next);
    const url = new URL(location.href);
    if (next === 'demo') url.searchParams.set('mode', 'demo');
    else url.searchParams.delete('mode');
    history.replaceState({}, '', url);
  }

  async function startShift() {
    if (networkState.kind !== 'ready') return;
    const chosenMinutes = mode === 'demo' ? 45 : Number(minutes);
    if (!Number.isInteger(chosenMinutes) || chosenMinutes < 5 || chosenMinutes > 180) {
      setMessage('请选择5至180分钟的专注时长。');
      return;
    }
    const network = networkState.network;
    const next = await mutate(fresh => ({ ...fresh, activeShift: planShift({ network, profile: fresh, minutes: chosenMinutes, mode, now: Date.now() }) }));
    if (next) {
      settledAttempt.current = '';
      setReceipt(null);
      openPane('delivery');
      const frame = next.activeShift ? readShift({ shift: next.activeShift, now: Date.now() }).scene : idleScene(next);
      currentScene.current = frame;
      controller.current?.setDelivery(frame);
      controller.current?.focusDelivery();
      controller.current?.followDelivery();
    }
  }

  async function stopEarly() {
    const next = await mutate(fresh => settleShift({ profile: fresh, now: Date.now(), early: true }).profile);
    if (next) {
      setReceipt(next.receipts[0] ?? null);
      openPane('receipt');
    }
  }

  async function purchase(itemId: string) {
    const next = await mutate(fresh => {
      const result = buyUpgrade({ profile: fresh, itemId });
      if (!result.ok) throw new Error(result.message);
      return result.profile;
    });
    if (next) {
      const item = DELIVERY_UPGRADES.find(candidate => candidate.id === itemId);
      setMessage(`已购入${item?.name ?? '新装备'}，下一趟配送就能用上。`);
    }
  }

  const network = networkState.kind === 'ready' ? networkState.network : null;
  const shownOrders = progress?.orders ?? receipt?.orders ?? profile?.receipts[0]?.orders ?? [];
  const currentOrder = progress?.currentOrder;
  const modeLabel = mode === 'demo' ? '快速试玩' : '正常专注';
  const modeButtons = <div className="delivery-mode" role="group" aria-label="体验模式">
    <button aria-pressed={mode === 'focus'} disabled={busy} onClick={() => selectMode('focus')}>正常专注</button>
    <button aria-pressed={mode === 'demo'} disabled={busy} onClick={() => selectMode('demo')}>{copy.demo}</button>
  </div>;
  let title = '在深圳，开工。';
  let kind = `外卖专注，${modeLabel}`;
  let status = '准备出发';
  let rows: CardRow[] = [];
  let actions: CardAction[] = [];
  let bar: { label: string; value: number; maximum: number } | undefined;

  if (store.kind === 'loading') {
    status = '正在读取';
    rows = [['存档', '正在准备这位骑手的生活。']];
  } else if (store.kind === 'invalid') {
    status = '存档需要检查';
    rows = [['说明', <span className="delivery-message">{store.message} 原存档已保留，没有覆盖。</span>], ['体验', modeButtons]];
    actions = [{ label: '重新读取', onClick: () => readStore(mode) }];
  } else if (profile) {
    if (pane === 'delivery' && shift && progress) {
      title = copy.focusRunning;
      status = phaseNames[progress.currentPhase];
      bar = { label: `已送 ${progress.completedCount} / ${shift.orders.length} 单`, value: progress.progress, maximum: 1 };
      rows = [
        ['剩余', <><span className="delivery-clock">{clock(progress.remainingMs)}</span><span className="delivery-sub">{mode === 'demo' ? copy.demoHint : `${shift.minutes}分钟专注，${copy.normalHint}`}</span></>],
        ['取餐', currentOrder?.merchant.name ?? '这趟配送已完成'],
        ['送往', currentOrder?.customer.name ?? '准备收工'],
        ['本趟收入', <span className="delivery-metric">{money(progress.earnedCents)}</span>],
        ['骑手评分', `${profile.rating.toFixed(1)} / 5.0`],
      ];
      const lastEvent = progress.events.at(-1);
      if (lastEvent) rows.push(['沿途', <span className="delivery-story">{lastEvent.story}</span>]);
      actions = [
        { label: '跟随', onClick: () => controller.current?.followDelivery() },
        { label: '订单', onClick: () => openPane('orders') },
        { label: copy.earlyFinish, disabled: busy, onClick: () => openPane('early') },
      ];
    } else if (pane === 'orders') {
      title = shift ? '这一趟的订单' : '上一趟的订单';
      status = shownOrders.length ? `${shownOrders.length} 单配送` : '还没有订单';
      rows = shownOrders.length ? shownOrders.map((item, index): CardRow => [String(index + 1).padStart(2, '0'), <div className="delivery-order">
        <span>{item.order.merchant.name}</span><span>↓ {item.order.customer.name}</span>
        <small>{phaseNames[item.phase]}{item.late ? '，已超时' : ''}，{money(item.phase === 'delivered' ? item.earnedCents : item.order.feeCents)}</small>
        {item.order.event.atMinute <= (progress?.elapsedMinutes ?? Infinity) && <small>{item.order.event.story}</small>}
      </div>]) : [['订单', <span className="delivery-empty">设好专注时间，系统就会安排这一趟的取送路线。</span>]];
      actions = [{ label: '回到配送', onClick: () => openPane('delivery') }, { label: '跟随', onClick: () => controller.current?.followDelivery() }];
    } else if (pane === 'my') {
      title = copy.profile;
      status = `${profile.completedOrders} 单已送达`;
      rows = [
        ['钱包', <span className="delivery-metric">{money(profile.walletCents)}</span>],
        ['评分', `${profile.rating.toFixed(1)} / 5.0`],
        ['已专注', `${Math.floor(profile.totalFocusMinutes)} 分钟`],
        ['住处', <svg className="delivery-room" viewBox="0 0 220 100" aria-label={profile.ownedItems.includes('window-plant') ? '窗边放着新买的绿植' : '收工后的小房间'} fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M16 85V13h188v72H16ZM16 85l24-18h148l16 18M40 67V27h148v40M40 67l-24 18M188 67l16 18M116 27v40M141 27v40M116 47h72M55 62h47v5M58 62V45h39v17M55 74h47v7M58 74v7M99 74v7" />
          {profile.ownedItems.includes('window-plant') && <g className="room-plant"><path d="M153 63h16l-3 12h-10l-3-12ZM161 63V44M161 52c-13 0-14-9-12-12 9 0 12 6 12 12ZM161 56c13 0 15-10 12-13-9 1-12 7-12 13Z" /></g>}
        </svg>],
        ...DELIVERY_UPGRADES.map((item): CardRow => [item.category === 'vehicle' ? '车辆' : item.category === 'home' ? '住处' : '装备', <div className="delivery-shop"><strong>{item.name}</strong><small>{item.description}</small><button disabled={busy || Boolean(shift) || profile.ownedItems.includes(item.id) || profile.walletCents < item.priceCents} onClick={() => void purchase(item.id)}>{profile.ownedItems.includes(item.id) ? '已拥有' : `购入，${money(item.priceCents)}`}</button></div>]),
      ];
      if (shift) rows.push(['添置', '这一趟结束后，可以购入新装备。']);
      actions = [{ label: '回到配送', onClick: () => openPane('delivery') }];
    } else if (pane === 'explore') {
      title = copy.explore;
      status = `${profile.visitedAreas.length} 个片区，${profile.visitedLandmarks.length} 处地标`;
      rows = [
        ['里程', distance(profile.receipts.reduce((sum, item) => sum + item.distanceMeters, 0))],
        ['片区', profile.visitedAreas.length ? <span className="delivery-neighborhood">{profile.visitedAreas.join('，')}</span> : copy.emptyExplore],
        ['地标', profile.visitedLandmarks.length ? profile.visitedLandmarks.map(id => network?.landmarks.find(item => item.id === id)?.name ?? '城市地标').join('，') : '骑过地标附近，就能把它记下来。'],
        ...Object.entries(profile.familiarShops).map(([id, count]): CardRow => ['熟悉的小店', <><span>{network?.places.find(place => place.id === id)?.name ?? '街边小店'}</span><span className="delivery-sub">已经来过 {count} 次{count >= 3 ? '，店员记住了你' : '，再来几次，就成了熟面孔'}</span></>]),
      ];
      const story = profile.receipts.flatMap(item => item.orders).find(item => item.phase === 'delivered');
      if (story) rows.push(['街坊记事', <span className="delivery-story">{story.order.event.story}</span>]);
      actions = [{ label: '全城看看', onClick: () => controller.current?.overview() }, { label: '回到骑手', onClick: () => { controller.current?.focusDelivery(); openPane('delivery'); } }];
    } else if (pane === 'early' && shift && progress) {
      title = copy.earlyTitle;
      status = `还有 ${shift.orders.length - progress.completedCount} 单未送完`;
      rows = [
        ['已送订单', `${progress.completedCount} 单，配送费照常结算`],
        ['未送订单', copy.earlyHint],
        ['已专注', `${Math.floor(progress.elapsedMinutes)} / ${shift.minutes} 分钟`],
        ['提示', <span className="delivery-intro">只是去别的软件工作，可以直接离开页面。这趟配送会继续。</span>],
      ];
      actions = [{ label: copy.keepWorking, onClick: () => openPane('delivery') }, { label: copy.confirmEarly, disabled: busy, onClick: () => void stopEarly() }];
    } else if (pane === 'receipt' && (receipt ?? profile.receipts[0])) {
      const ticket = receipt ?? profile.receipts[0];
      title = ticket.early ? '今天先到这里。' : '这一趟，辛苦了。';
      kind = `${modeLabel}，${copy.receipt}`;
      status = ticket.early ? '提前收工' : '配送完成';
      rows = [
        ['本趟专注', `${Math.floor(ticket.minutes)} 分钟`],
        ['已送达', `${ticket.completedOrders} 单${ticket.cancelledOrders ? `，取消 ${ticket.cancelledOrders} 单` : ''}`],
        ['配送里程', distance(ticket.distanceMeters)],
        ['配送费', money(ticket.grossCents)],
        ['超时扣费', ticket.penaltyCents ? `−${money(ticket.penaltyCents)}` : '没有扣费'],
        ['本趟实收', <strong className="delivery-metric">{money(ticket.earnedCents)}</strong>],
        ['评分变化', `${ticket.ratingChange >= 0 ? '+' : ''}${ticket.ratingChange.toFixed(1)}，当前 ${profile.rating.toFixed(1)}`],
        ['钱包', money(profile.walletCents)],
        ['留下足迹', ticket.areas.join('，') || '熟悉的街区'],
      ];
      actions = [{ label: '添置装备', onClick: () => openPane('my') }, { label: '看看足迹', onClick: () => openPane('explore') }, { label: copy.anotherShift, onClick: () => openPane('delivery') }];
    } else {
      rows = [
        ['你去专注', <p className="delivery-intro">{copy.intro}取餐、赶路、送达都交给骑手，收工再看今天的故事。</p>],
        ['体验', modeButtons],
        [copy.duration, mode === 'demo' ? <><span>45 分钟</span><span className="delivery-sub">{copy.demoHint}</span></> : <div className="delivery-minutes"><input type="number" min="5" max="180" step="1" value={minutes} aria-label="专注分钟数" onChange={event => setMinutes(event.target.value)} /><span>分钟</span></div>],
        ...(mode === 'focus' ? [['常用', <div className="delivery-durations">{[25, 45, 60].map(value => <button key={value} aria-pressed={minutes === String(value)} onClick={() => setMinutes(String(value))}>{value}分</button>)}</div>] satisfies CardRow[] : []),
        ['这一趟', '系统按时长安排多单，45分钟至少两单'],
        ['钱包', money(profile.walletCents)],
        ['骑手评分', `${profile.rating.toFixed(1)} / 5.0`],
        ['出发', profile.receipts.length ? '从上次收工的位置继续' : '深圳湾，第一天开工'],
      ];
      if (networkState.kind === 'error') rows.push(['路网', <span className="delivery-message">{networkState.message}</span>]);
      actions = [
        { label: networkState.kind === 'loading' ? '正在准备路线' : mode === 'demo' ? '开始试跑' : copy.start, disabled: busy || networkState.kind !== 'ready', onClick: () => void startShift() },
        { label: '找到骑手', onClick: () => controller.current?.focusDelivery() },
        ...(networkState.kind === 'error' ? [{ label: '重新载入', onClick: () => setNetworkAttempt(value => value + 1) }] : []),
      ];
    }
    if (store.notice) rows.push(['存档', <span className="delivery-message">{store.notice}</span>]);
  }
  if (message) rows.push(['提示', <span className="delivery-message" role="status">{message}</span>]);

  const tripStatus = progress ? progress.scene.status : profile?.receipts.length ? '骑手已收工，下一趟从这里出发' : '深圳湾，等待第一张订单';
  const navItems: { pane: Pane; label: string }[] = [{ pane: 'delivery', label: '配送' }, { pane: 'orders', label: '订单' }, { pane: 'my', label: '我的' }, { pane: 'explore', label: '足迹' }];
  return <main className="delivery-prototype">
    <figure>
      <div className="cap">
        <span className="hi delivery-title"><span className="delivery-dot" />图 2，<span id="clock">{snapshot.clock}</span><span id="phase">{snapshot.phase}</span></span>
        <nav className="sites" aria-label="配送生活">
          {navItems.map(item => <button key={item.pane} aria-current={pane === item.pane && cardVisible ? 'true' : undefined} onClick={() => openPane(item.pane)}>{item.label}</button>)}
          <button onClick={() => controller.current?.overview()}>深圳全景</button>
          <a href="/">骑行地图 ↗</a>
        </nav>
      </div>
      <div className="stage" id="stage">
        <CityMap routes={MAP_ROUTES} onController={onController} onSnapshot={onSnapshot} />
        <div className="tools" id="tools">
          <button id="zoomIn" title="放大 (+)" aria-label="放大" onClick={() => controller.current?.zoomBy(1.4)}><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg></button>
          <button id="zoomOut" title="缩小 (−)" aria-label="缩小" onClick={() => controller.current?.zoomBy(1 / 1.4)}><svg viewBox="0 0 16 16"><path d="M3 8h10" /></svg></button>
          <button id="home" title="找到骑手" aria-label="找到骑手" onClick={() => controller.current?.focusDelivery()}><svg viewBox="0 0 16 16"><path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" /></svg></button>
          <span className="gap" />
          <button id="pause" title="只暂停城市动画，专注仍继续" aria-label={snapshot.paused ? '继续城市动画' : '暂停城市动画'} aria-pressed={snapshot.paused} onClick={() => controller.current?.togglePause()}><svg viewBox="0 0 16 16"><path d={snapshot.paused ? 'M5 3.5v9l7-4.5z' : 'M5.5 3.5v9M10.5 3.5v9'} /></svg></button>
          <button id="theme" title="明暗主题 (T)" aria-label="切换明暗主题" onClick={() => controller.current?.toggleTheme()}><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="M8 3a5 5 0 0 0 0 10z" fill="currentColor" /></svg></button>
          <button id="time" title="只快进城市时刻，不改变专注计时" aria-label="快进城市六小时" onClick={() => controller.current?.skipTime()}><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 4.8V8l2.2 1.6" /></svg></button>
        </div>
        <div className="tag hover" id="tagHover" hidden />
        <div className="tag" id="tagSel" hidden />
        <div className="tag stop" id="tagStop" hidden />
        <SelectionCard cardRef={card} hidden={!cardVisible} page={pane} kind={kind} title={title} status={status} rows={rows} actions={actions} bar={bar} onClose={() => setCardVisible(false)} />
        <p className="note" id="note" hidden />
        <div className="delivery-trip" aria-label="当前配送">
          <span className="delivery-dot" />
          <span className="delivery-trip-status">{tripStatus}</span>
          {progress && shift && <span className="delivery-trip-time">{clock(progress.remainingMs)}，{progress.completedCount}/{shift.orders.length} 单</span>}
          <button onClick={() => openPane('delivery')}>{cardVisible ? '配送详情' : '展开详情'}</button>
        </div>
      </div>
      <div className="cap">
        <span className="delivery-cap-meta">{copy.prototype}，虚构订单，{mode === 'demo' ? '独立试玩存档' : '本地存档'}</span>
        <span className="hi delivery-cap-meta" id="readout">{progress ? copy.intro : '拖动平移，滚轮缩放，点击查看'}</span>
      </div>
    </figure>
  </main>;
}
