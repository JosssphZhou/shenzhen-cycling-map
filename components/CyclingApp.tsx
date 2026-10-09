'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { routes } from '@/lib/routes';
import { createGpx } from '@/lib/gpx';
import type { CyclingRoute } from '@/lib/types';
import { INITIAL_SNAPSHOT, PLACE_KEYS, PLACE_NAMES, type SceneController, type SceneSnapshot } from '@/scene/contract';
import SelectionCard, { type CardAction, type CardRow } from './SelectionCard';

const CityMap = dynamic(() => import('./CityMap'), { ssr: false });
const districts = ['南山', '福田', '罗湖', '盐田', '宝安', '龙华', '龙岗', '光明', '坪山', '大鹏'];
const distanceText = (route: CyclingRoute) => route.distanceKm === null ? '里程待核' : `${route.distanceKm.toFixed(1)} 公里`;
type AuxiliaryCard = 'routes' | 'filters' | 'more' | 'access' | 'evidence' | 'route-sources' | 'share' | 'sources' | 'all-sources' | null;

/** Factory 的图版和六个工具按钮原样复用；骑行资料只替换原对象卡的内容。 */
export default function CyclingApp() {
  const controller = useRef<SceneController | null>(null);
  const lastSelection = useRef<string | null>(null);
  const lastSelectionRevision = useRef(0);
  const card = useRef<HTMLElement>(null);
  const [snapshot, setSnapshot] = useState<SceneSnapshot>(INITIAL_SNAPSHOT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [auxiliary, setAuxiliary] = useState<AuxiliaryCard>(null);
  const [relatedIds, setRelatedIds] = useState<string[] | null>(null);
  const [district, setDistrict] = useState('全深圳');
  const [distance, setDistance] = useState('全部距离');
  const [climb, setClimb] = useState('全部爬升');
  const [search, setSearch] = useState('');
  const [trackOnly, setTrackOnly] = useState(false);
  const [day, setDay] = useState('工作日');
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const selected = routes.find(route => route.id === selectedId) ?? null;
  const restricted = Boolean(selected?.weekdayOnly && day === '周末与节假日');
  const page = auxiliary ?? (selected ? 'route' : 'entity');
  const cardVisible = Boolean(auxiliary || selected || snapshot.selection);
  const routeMenuOpen = auxiliary !== null;

  const syncFromUrl = useCallback(() => {
    const id = new URL(location.href).searchParams.get('路线');
    const route = routes.find(item => item.id === id) ?? null;
    setSelectedId(route?.id ?? null);
    controller.current?.selectRoute(route);
    setShareUrl('');
    if (id && !route) {
      setAuxiliary('routes');
      setRelatedIds(null);
      setMessage('没有找到这条路线，请从路线集重新选择。');
    } else {
      setAuxiliary(null);
      setMessage('');
    }
  }, []);

  const onController = useCallback((value: SceneController | null) => {
    controller.current = value;
    lastSelection.current = null;
    lastSelectionRevision.current = 0;
    if (value) syncFromUrl();
  }, [syncFromUrl]);

  const onSnapshot = useCallback((value: SceneSnapshot) => {
    const id = value.selection?.id ?? null;
    const revision = value.selectionRevision ?? 0;
    if (id !== lastSelection.current || revision !== lastSelectionRevision.current) {
      lastSelection.current = id;
      lastSelectionRevision.current = revision;
      setSelectedId(value.selection?.routeId ?? null);
      setAuxiliary(null);
      setShareUrl('');
      setMessage('');
      if (controller.current) {
        const url = new URL(location.href);
        if (value.selection?.routeId) url.searchParams.set('路线', value.selection.routeId);
        else url.searchParams.delete('路线');
        if (url.href !== location.href) history.replaceState({}, '', url);
      }
      requestAnimationFrame(() => card.current?.scrollTo({ top: 0 }));
    }
    setSnapshot(value);
  }, []);

  useEffect(() => {
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [syncFromUrl]);

  // 场景快捷键由原作交互层统一处理；这里只关闭辅助资料卡。
  useEffect(() => {
    if (!auxiliary) return;
    const closeAuxiliary = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      closeCard();
    };
    window.addEventListener('keydown', closeAuxiliary);
    return () => window.removeEventListener('keydown', closeAuxiliary);
  }, [auxiliary]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 7000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function updateUrl(id: string | null) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('路线', id);
    else url.searchParams.delete('路线');
    if (url.href !== location.href) history.pushState({}, '', url);
  }

  function selectRoute(route: CyclingRoute) {
    setSelectedId(route.id);
    setAuxiliary(null);
    setShareUrl('');
    setMessage('');
    updateUrl(route.id);
    controller.current?.selectRoute(route);
    requestAnimationFrame(() => card.current?.scrollTo({ top: 0 }));
  }

  function closeCard() {
    setAuxiliary(null);
    setSelectedId(null);
    setMessage('');
    setShareUrl('');
    controller.current?.clearSelection();
    updateUrl(null);
    document.getElementById('view')?.focus();
  }

  function resetFilters() {
    setSearch('');
    setDistrict('全深圳');
    setDistance('全部距离');
    setClimb('全部爬升');
    setTrackOnly(false);
  }

  function showRoutes(ids: string[] | null = null) {
    resetFilters();
    setRelatedIds(ids);
    setAuxiliary('routes');
    setMessage('');
    setShareUrl('');
    requestAnimationFrame(() => card.current?.scrollTo({ top: 0 }));
  }

  function openPage(next: AuxiliaryCard) {
    setAuxiliary(next);
    setMessage('');
    requestAnimationFrame(() => card.current?.scrollTo({ top: 0 }));
  }

  const visibleRoutes = useMemo(() => routes.filter(route => {
    if (relatedIds && !relatedIds.includes(route.id)) return false;
    if (district !== '全深圳' && !route.districts.some(value => value.includes(district))) return false;
    if (search.trim() && !`${route.name}${route.districts.join('')}${route.highlights.join('')}`.includes(search.trim())) return false;
    if (trackOnly && !route.exportable) return false;
    if (distance === '20 公里以内' && (route.distanceKm === null || route.distanceKm > 20)) return false;
    if (distance === '20 至 50 公里' && (route.distanceKm === null || route.distanceKm < 20 || route.distanceKm > 50)) return false;
    if (distance === '50 公里以上' && (route.distanceKm === null || route.distanceKm < 50)) return false;
    if (climb === '300 米以内' && (route.ascentM === null || route.ascentM > 300)) return false;
    if (climb === '300 米以上' && (route.ascentM === null || route.ascentM < 300)) return false;
    if (climb === '待核实' && route.ascentM !== null) return false;
    return true;
  }).sort((a, b) => Number(b.exportable) - Number(a.exportable)), [relatedIds, district, distance, climb, search, trackOnly]);

  function exportTrack() {
    if (!selected || restricted || !selected.exportable) return;
    try {
      const gpx = createGpx(selected);
      const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${selected.name}.gpx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('轨迹已导出。出发前请再次留意沿途通行公告。');
    } catch {
      setMessage('这条路线的轨迹尚未完成核验，暂时无法导出。');
    }
  }

  async function share() {
    if (!selected) return;
    openPage('share');
    const url = new URL(location.href);
    url.searchParams.delete('debug');
    url.searchParams.set('路线', selected.id);
    setShareUrl(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setMessage('路线链接已复制。本地地址只在能访问这台电脑时有效。');
    } catch {
      setMessage('请复制卡片中的路线链接。');
    }
  }

  const sourceItems = useMemo(() => Array.from(new Map(routes.flatMap(route => route.sources).map(source => [source.url, source])).values()), []);
  const entity = snapshot.selection;
  const brief = (text: string) => text.split(/[；。]/)[0];
  const menu = (label: string, onClick: () => void) => <button className="menu-link" onClick={onClick}>{label}</button>;
  const sourceRows = (items: CyclingRoute['sources']): CardRow[] => items.map((source, index) => [String(index + 1).padStart(2, '0'), <><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><br /><small>{source.published ? `发布于 ${source.published} · ` : ''}核对于 {source.checked}</small></>]);
  let kind = selected ? selected.districts.join(' · ') : entity?.kind;
  let title = selected?.name ?? entity?.title;
  let status = selected ? restricted ? '所选日期不适用' : selected.exportable ? '已有核对轨迹' : '轨迹待核' : entity?.status;
  let rows: CardRow[] = selected ? [
    ['里程', distanceText(selected)], ['爬升', selected.ascentM === null ? '待核实' : `${selected.ascentM} 米`],
    ['起点', selected.start], ['终点', selected.end],
    ['公路车', brief(selected.roadBike)], ['路面', brief(selected.surface)],
    ['通行', restricted ? '周末及节假日禁骑，请改选工作日' : selected.restrictions[0] ? brief(selected.restrictions[0]) : selected.status],
    ...(selected.weekdayOnly ? [['计划日期', day] as CardRow] : []),
  ] : entity?.rows ?? [];
  let actions: CardAction[] = selected ? [
    { label: '查看', onClick: () => controller.current?.focusSelection() },
    { label: '导出', onClick: exportTrack, disabled: !selected.exportable || restricted, title: restricted ? '所选日期不适用' : selected.exportable ? '导出真实经纬度轨迹' : '轨迹尚未完成核验' },
    { label: '更多', onClick: () => openPage('more') },
  ] : entity ? [
    ...(!entity.followable ? [{ label: '查看', onClick: () => controller.current?.focusSelection() }] : []),
    ...(entity.relatedRouteIds.length ? [{ label: '附近路线', onClick: () => showRoutes(entity.relatedRouteIds) }] : []),
    { label: '全部路线', onClick: () => showRoutes() },
  ] : [];
  const follow = !auxiliary && !selected && entity?.followable ? { pressed: entity.following, onClick: () => controller.current?.toggleFollow() } : undefined;
  const backToMore: CardAction = { label: '返回', onClick: () => openPage('more') };

  switch (auxiliary) {
    case 'routes':
      kind = '公路车 · 骑前选线'; title = relatedIds ? '附近骑行路线' : '深圳骑行路线'; status = `${visibleRoutes.length} 条路线`;
      rows = [
        ['范围', relatedIds ? '当前地标附近' : '全深圳'],
        ['可导出', `${visibleRoutes.filter(route => route.exportable).length} 条`],
        ['筛选', menu('筛选路线', () => openPage('filters'))],
        ['资料', menu('资料与致谢', () => openPage('sources'))],
        ...visibleRoutes.map((route, index): CardRow => [String(index + 1).padStart(2, '0'), <>{menu(route.name, () => selectRoute(route))}<br /><small>{distanceText(route)} · {route.intensity} · {route.exportable ? '有轨迹' : route.status === '待核' ? '通行待核' : '轨迹待核'}</small><br /><small>{route.bestFor}</small></>]),
        ...(!visibleRoutes.length ? [['筛选结果', '没有符合条件的路线。可放宽筛选；未知里程和爬升不会计作零。'] as CardRow] : []),
      ];
      actions = [
        { label: '筛选', onClick: () => openPage('filters') },
        relatedIds ? { label: '全部路线', onClick: () => showRoutes() } : { label: '资料', onClick: () => openPage('sources') },
        ...((entity || selected) ? [{ label: '返回详情', onClick: () => openPage(null) }] : relatedIds ? [{ label: '资料', onClick: () => openPage('sources') }] : []),
      ];
      break;
    case 'filters':
      kind = '路线集'; title = '筛选路线'; status = `${visibleRoutes.length} 条符合条件`;
      rows = [
        ['搜索', <input type="search" aria-label="搜索路线或地点" placeholder="路线或地点" value={search} onChange={event => setSearch(event.target.value)} />],
        ['区域', <select aria-label="按区域筛选" value={district} onChange={event => setDistrict(event.target.value)}><option>全深圳</option>{districts.map(value => <option key={value}>{value}</option>)}</select>],
        ['距离', <select aria-label="按距离筛选" value={distance} onChange={event => setDistance(event.target.value)}>{['全部距离', '20 公里以内', '20 至 50 公里', '50 公里以上'].map(value => <option key={value}>{value}</option>)}</select>],
        ['爬升', <select aria-label="按爬升筛选" value={climb} onChange={event => setClimb(event.target.value)}>{['全部爬升', '300 米以内', '300 米以上', '待核实'].map(value => <option key={value}>{value}</option>)}</select>],
        ['已有轨迹', <label><input type="checkbox" checked={trackOnly} onChange={event => setTrackOnly(event.target.checked)} /> 只看可导出路线</label>],
      ];
      actions = [{ label: '路线集', onClick: () => openPage('routes') }, { label: '重置', onClick: resetFilters }];
      break;
    case 'more':
      if (!selected) break;
      kind = '骑行资料'; title = selected.name;
      rows = [
        ['简介', selected.summary], ['适合', selected.bestFor], ['强度', selected.intensity],
        ['公路车', selected.roadBike], ['路面', selected.surface],
        ['通行', menu('计划日期、通行与补给', () => openPage('access'))],
        ['依据', menu('里程、爬升与轨迹', () => openPage('evidence'))],
        ['来源', menu(`${selected.sources.length} 项公开资料`, () => openPage('route-sources'))],
        ['分享', menu('复制路线链接', share)],
      ];
      actions = [{ label: '返回', onClick: () => openPage(null) }, { label: '路线集', onClick: () => showRoutes() }, { label: '资料', onClick: () => openPage('sources') }];
      break;
    case 'access':
      if (!selected) break;
      kind = selected.name; title = '通行与补给'; status = restricted ? '所选日期不适用' : '出发前确认';
      rows = [
        ['计划骑行', <select aria-label="计划骑行日期" value={day} onChange={event => setDay(event.target.value)}><option>工作日</option><option>周末与节假日</option></select>],
        ...(restricted ? [['提醒', <span role="status">本路线含周末与节假日禁骑路段，请改选工作日或其他路线。</span>] as CardRow] : []),
        ...(selected.hours ? [['开放时间', selected.hours] as CardRow] : []),
        ...selected.restrictions.map((value, index): CardRow => [`通行 ${index + 1}`, value]),
        ['沿途', selected.highlights.join(' · ')], ['补给', selected.services],
      ];
      actions = [backToMore, { label: '路线集', onClick: () => showRoutes() }];
      break;
    case 'evidence':
      if (!selected) break;
      kind = selected.name; title = '里程、爬升与轨迹'; status = selected.geometryStatus;
      rows = [['里程', selected.distanceNote], ['爬升', selected.ascentNote], ['轨迹', selected.geometryNote], ['使用', '地图线路与导出文件使用同一份真实经纬度，分段分别显示。导出文件可导入码表与骑行软件。']];
      actions = [backToMore, { label: '来源', onClick: () => openPage('route-sources') }];
      break;
    case 'route-sources':
      if (!selected) break;
      kind = selected.name; title = '路线资料来源'; status = `${selected.sources.length} 项资料`;
      rows = sourceRows(selected.sources);
      actions = [backToMore, { label: '资料', onClick: () => openPage('sources') }];
      break;
    case 'share':
      if (!selected) break;
      kind = selected.name; title = '分享路线'; status = '本地预览链接';
      rows = [['路线链接', <input value={shareUrl} readOnly aria-label="路线分享链接" onFocus={event => event.target.select()} />], ['访问', '本地地址只在能访问这台电脑时有效；尚未发布到互联网。']];
      actions = [{ label: '复制', onClick: share }, backToMore];
      break;
    case 'sources':
      kind = '深圳骑行地图'; title = '资料与致谢'; status = '核对于 2026 年 10 月 8 日';
      rows = [
        ['底图', '深圳海岸、街区、河湖与山体来自真实地理数据，建筑细节随视野加载。已核路线按原始经纬度落在地图上。'],
        ['场景', '地标造型、骑手、时间和天气为场景示意。'],
        ['通行', '临时封闭、现场标识和管理方最新通知优先。爬升没有可靠数据时保留待核。'],
        ['开放地图', <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© 开放街道地图贡献者</a><br />海岸、河湖、道路、区界与真实轨迹 · 开放数据库许可</>],
        ['建筑轮廓', <><a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">Overture Maps Foundation</a><br />城市建筑位置与轮廓 · 开放数据库许可</>],
        ['建筑研究', <><a href="https://doi.org/10.5281/zenodo.8174931" target="_blank" rel="noreferrer">东亚建筑矢量数据研究</a><br />Qian Shi 等研究者 · 知识共享署名 4.0 许可 · 已裁切、简化并划分显示层级</>],
        ['山体高程', <><a href="https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM" target="_blank" rel="noreferrer">哥白尼全球高程数据</a><br />经裁切和重采样，仅供地形观察，不用于计算路线爬升。</>],
        ['高程署名', <span lang="en">produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved</span>],
        ['原作', <><a href="https://github.com/Khalidabdi1/factory" target="_blank" rel="noreferrer">原作仓库</a><br />参考版本 148758ae · 图版、控件、渲染与交互来源</>],
        ['致谢', '保留原作对 ai-iso-skill（Tolga Cohce）与 Three.js 的致谢。本项目仅供本地预览，尚未公开发布。'],
      ];
      actions = [{ label: '路线集', onClick: () => showRoutes() }, { label: '路线资料', onClick: () => openPage('all-sources') }, ...((entity || selected) ? [{ label: '返回详情', onClick: () => openPage(null) }] : [])];
      break;
    case 'all-sources':
      kind = '资料与致谢'; title = '路线公开资料'; status = `${sourceItems.length} 项资料`;
      rows = sourceRows(sourceItems);
      actions = [{ label: '返回', onClick: () => openPage('sources') }, { label: '路线集', onClick: () => showRoutes() }];
      break;
  }
  if (message) rows = [...rows, ['提示', <span role="status">{message}</span>]];

  return <main>
    <figure>
      <div className="cap">
        <span className="hi">图 1 · <span id="clock">{snapshot.clock}</span><span id="phase">{snapshot.phase}</span></span>
        <nav className="sites" aria-label="地点">
          {PLACE_NAMES.map((name, index) => <button key={name} data-view={index} title={`${name} (${PLACE_KEYS[index]})`} aria-current={!routeMenuOpen && snapshot.activeView === index ? 'true' : undefined} onClick={() => controller.current?.goView(index)}>{name}</button>)}
          <button title="浏览深圳骑行路线" aria-current={routeMenuOpen ? 'true' : undefined} onClick={() => showRoutes()}>路线</button>
        </nav>
      </div>
      <div className="stage" id="stage">
        <CityMap routes={routes} onController={onController} onSnapshot={onSnapshot} />
        <div className="tools" id="tools">
          <button id="zoomIn" title="放大 (+)" aria-label="放大" onClick={() => controller.current?.zoomBy(1.4)}><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg></button>
          <button id="zoomOut" title="缩小 (−)" aria-label="缩小" onClick={() => controller.current?.zoomBy(1 / 1.4)}><svg viewBox="0 0 16 16"><path d="M3 8h10" /></svg></button>
          <button id="home" title="重置视角 (0)" aria-label="重置视角" onClick={() => controller.current?.overview()}><svg viewBox="0 0 16 16"><path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" /></svg></button>
          <span className="gap" />
          <button id="pause" title={snapshot.paused ? '继续 (空格)' : '暂停 (空格)'} aria-label={snapshot.paused ? '继续' : '暂停'} aria-pressed={snapshot.paused} onClick={() => controller.current?.togglePause()}><svg viewBox="0 0 16 16"><path d={snapshot.paused ? 'M5 3.5v9l7-4.5z' : 'M5.5 3.5v9M10.5 3.5v9'} /></svg></button>
          <button id="theme" title="明暗主题 (T)" aria-label="切换明暗主题" onClick={() => controller.current?.toggleTheme()}><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="M8 3a5 5 0 0 0 0 10z" fill="currentColor" /></svg></button>
          <button id="time" title="快进六小时 (N)" aria-label="快进六小时" onClick={() => controller.current?.skipTime()}><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 4.8V8l2.2 1.6" /></svg></button>
        </div>
        <div className="tag hover" id="tagHover" hidden />
        <div className="tag" id="tagSel" hidden />
        <div className="tag stop" id="tagStop" hidden />
        <SelectionCard cardRef={card} hidden={!cardVisible} page={page} kind={kind} title={title} status={status} rows={rows} actions={actions} follow={follow} onClose={closeCard} />
        <p className="note" id="note" hidden />
      </div>
      <div className="cap">
        <span className="fine">拖动平移 · 滚轮缩放 · 点击查看</span>
        <span className="coarse">拖动平移 · 双指缩放 · 轻点查看</span>
        <span className="hi" id="readout">{snapshot.readout}</span>
      </div>
    </figure>
  </main>;
}
