'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { routes } from '@/lib/routes';
import { createGpx } from '@/lib/gpx';
import type { CyclingRoute } from '@/lib/types';
import Icon from './Icons';

const CityMap = dynamic(() => import('./CityMap'), { ssr: false, loading: () => <div className="map-loading">正在展开深圳的山海与街巷…</div> });
const districts = ['南山','福田','罗湖','盐田','宝安','龙华','龙岗','光明','坪山','大鹏'];
const clockText = (time: number) => `${String(Math.floor(time)%24).padStart(2,'0')}:${String(Math.floor((time%1)*60)).padStart(2,'0')}`;
const distanceText = (route: CyclingRoute) => route.distanceKm === null ? '里程待核' : `${route.distanceKm.toFixed(1)} 公里`;

export default function CyclingApp() {
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [district,setDistrict] = useState('全深圳');
  const [distance,setDistance] = useState('全部距离');
  const [climb,setClimb] = useState('全部爬升');
  const [search,setSearch] = useState('');
  const [trackOnly,setTrackOnly] = useState(false);
  const [day,setDay] = useState('工作日');
  const [panelOpen,setPanelOpen] = useState(false);
  const [isOverview,setIsOverview] = useState(false);
  const [theme,setTheme] = useState<'light'|'dark'>('light');
  const [time,setTime] = useState(13.5);
  const [paused,setPaused] = useState(false);
  const [weather,setWeather] = useState<'晴'|'雨'|'雾'>('晴');
  const [overviewKey,setOverviewKey] = useState(0);
  const [toast,setToast] = useState('');
  const [shareUrl,setShareUrl] = useState('');
  const [sourcesOpen,setSourcesOpen] = useState(false);
  const [stats,setStats] = useState<{roads:number;buildings:number}|null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const selected = useMemo(()=>routes.find(route=>route.id===selectedId)??null,[selectedId]);
  useEffect(()=>{
    const sync=()=>{
      const id=new URL(location.href).searchParams.get('路线');
      if(id && !routes.some(route=>route.id===id)) {setToast('没有找到这条路线，请从路线集重新选择。');setSelectedId(null);return;}
      setSelectedId(id);if(id)setPanelOpen(true);
    };
    sync();window.addEventListener('popstate',sync);
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)setPaused(true);
    return()=>window.removeEventListener('popstate',sync);
  },[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  useEffect(()=>{document.documentElement.classList.toggle('after-dark',time<5.5||time>19.5);},[time]);
  useEffect(()=>{if(paused)return;const id=window.setInterval(()=>setTime(value=>(value+24/360)%24),1000);return()=>clearInterval(id);},[paused]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(id);},[toast]);
  useEffect(()=>{if(sourcesOpen)modalRef.current?.showModal();else modalRef.current?.close();},[sourcesOpen]);
  const selectRoute=useCallback((id:string)=>{
    setSelectedId(id);setPanelOpen(true);setIsOverview(false);setShareUrl('');
    const url=new URL(location.href);url.searchParams.set('路线',id);history.pushState({},'',url);
    requestAnimationFrame(()=>detailsRef.current?.scrollTo({top:0}));
  },[]);
  function overview(){setIsOverview(true);setSelectedId(null);setOverviewKey(key=>key+1);setShareUrl('');const url=new URL(location.href);url.searchParams.delete('路线');history.pushState({},'',url);}
  const visibleRoutes=useMemo(()=>routes.filter(route=>{
    if(district!=='全深圳'&&!route.districts.some(value=>value.includes(district)))return false;
    if(search&&!`${route.name}${route.districts.join('')}${route.highlights.join('')}`.includes(search.trim()))return false;
    if(trackOnly&&!route.exportable)return false;
    if(distance==='20 公里以内'&&(route.distanceKm===null||route.distanceKm>20))return false;
    if(distance==='20 至 50 公里'&&(route.distanceKm===null||route.distanceKm<20||route.distanceKm>50))return false;
    if(distance==='50 公里以上'&&(route.distanceKm===null||route.distanceKm<50))return false;
    if(climb==='300 米以内'&&(route.ascentM===null||route.ascentM>300))return false;
    if(climb==='300 米以上'&&(route.ascentM===null||route.ascentM<300))return false;
    if(climb==='待核实'&&route.ascentM!==null)return false;
    return true;
  }).sort((a,b)=>Number(b.exportable)-Number(a.exportable)),[district,search,trackOnly,distance,climb]);
  const restricted=!!(selected?.weekdayOnly&&day==='周末与节假日');
  function exportTrack(){
    if(!selected||restricted)return;
    try{
      const gpx=createGpx(selected);const blob=new Blob([gpx],{type:'application/gpx+xml;charset=utf-8'});const href=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=href;a.download=`${selected.name}.gpx`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
      setToast('轨迹已导出。出发前请再次留意沿途通行公告。');
    }catch{setToast('这条路线的轨迹尚未完成核验，暂时无法导出。');}
  }
  async function share(){
    if(!selected)return;const url=new URL(location.href);url.searchParams.delete('debug');url.searchParams.set('路线',selected.id);setShareUrl(url.href);
    try{await navigator.clipboard.writeText(url.href);setToast('路线链接已复制。当前本地地址仅在可访问这台电脑时可打开。');}catch{setToast('请复制下方路线链接。');}
  }
  const sourceItems=useMemo(()=>Array.from(new Map(routes.flatMap(route=>route.sources).map(source=>[source.url,source])).values()),[]);
  return <main className="app-shell">
    <figure className="city-plate">
      <header className="plate-heading">
        <div className="brand"><Icon name="bike"/><h1>深圳骑行地图</h1><span className="brand-note">山海之间，选一条路。</span></div>
        <div className="edition">骑前选线 <span>·</span> 全深圳</div>
      </header>
      <div className={`stage ${panelOpen?'with-panel':''}`}>
        <div className="map-layer"><CityMap route={selected} routes={routes} theme={theme} timeOfDay={time} weather={weather} paused={paused} overviewKey={overviewKey} onSelect={selectRoute} onOverview={overview} onReady={setStats}/></div>
        <div className="map-head"><span className="live-dot"/> <span>{selected?selected.name:isOverview?'深圳 · 地标全景':'深圳湾 · 微缩场景'}</span><button className="text-button" onClick={overview}>全城地标 <Icon name="map"/></button></div>
        <div className="scene-tools" aria-label="场景设置">
          <button title="切换明暗主题" aria-label="切换明暗主题" onClick={()=>setTheme(value=>value==='light'?'dark':'light')}><Icon name={theme==='light'?'moon':'sun'}/></button>
          <button title={paused?'播放城市动态':'暂停城市动态'} aria-label={paused?'播放城市动态':'暂停城市动态'} onClick={()=>setPaused(value=>!value)}><Icon name={paused?'play':'pause'}/></button>
          <button title="切换场景天气" aria-label={`场景天气：${weather}，点击切换`} onClick={()=>setWeather(value=>value==='晴'?'雨':value==='雨'?'雾':'晴')}><Icon name={weather==='晴'?'sun':weather==='雨'?'rain':'fog'}/></button>
          <button className="scene-clock" title="场景时间前进六小时" aria-label="场景时间前进六小时" onClick={()=>setTime(value=>(value+6)%24)}>{clockText(time)}</button>
          <span className="simulation-label">场景模拟</span>
        </div>
        <button className={`panel-toggle ${panelOpen?'is-open':''}`} onClick={()=>setPanelOpen(value=>!value)} aria-expanded={panelOpen} aria-controls="route-panel"><Icon name={panelOpen?'close':'list'}/><span>{panelOpen?'收起路线':'浏览路线'}</span></button>
        {panelOpen&&<aside className="route-panel" id="route-panel" aria-label="骑行路线">
          {selected?<>
            <div className="panel-top"><button className="text-button" onClick={()=>{setSelectedId(null);setShareUrl('');const url=new URL(location.href);url.searchParams.delete('路线');history.pushState({},'',url);}}><Icon name="back"/>路线集</button><span>{selected.districts.join(' / ')}</span><span className="index-mark">{String(routes.indexOf(selected)+1).padStart(2,'0')}</span></div>
            <div className="detail-scroll" ref={detailsRef}>
              <div className="detail-title"><p className="eyebrow">{selected.bestFor}</p><h2>{selected.name}</h2><p>{selected.summary}</p></div>
              <div className="metrics"><div><strong>{selected.distanceKm===null?'待核':selected.distanceKm.toFixed(1)}</strong><span>公里 · {selected.geometryStatus==='已核对路网'?'轨迹里程':'资料里程'}</span></div><div><strong>{selected.ascentM===null?'待核':selected.ascentM}</strong><span>{selected.ascentM===null?'累计爬升待核':'米 · 累计爬升'}</span></div></div>
              <div className="route-stops"><div><span className="stop-dot"/><span>{selected.start}</span></div><i/><div><span className="stop-dot filled"/><span>{selected.end}</span></div></div>
              <div className="fact-row"><span>路面</span><p>{selected.surface}</p></div><div className="fact-row"><span>公路车</span><p>{selected.roadBike}</p></div><div className="fact-row"><span>沿途</span><p>{selected.highlights.join(' · ')}</p></div>
              <section className="access-note" aria-label="通行提醒"><div className="section-caption">出发前确认 <span>{selected.status==='待核'?'通行待核':restricted?'所选日期不适用':'分段规则'}</span></div><label className="day-select">计划骑行<select value={day} onChange={e=>setDay(e.target.value)}><option>工作日</option><option>周末与节假日</option></select></label>{restricted&&<p className="restriction-alert" role="status">本路线含周末与节假日禁骑路段，请改选工作日或其他路线。</p>}{selected.hours&&<p>开放时间：{selected.hours}</p>}<ul>{selected.restrictions.map((value,index)=><li key={index}>{value}</li>)}</ul></section>
              <div className="fact-row"><span>补给</span><p>{selected.services}</p></div>
              <details className="evidence"><summary>里程、爬升与轨迹依据</summary><p>{selected.distanceNote}</p><p>{selected.ascentNote}</p><p>{selected.geometryNote}</p></details>
              <details className="evidence"><summary>查看资料来源 <span>{selected.sources.length} 项</span></summary>{selected.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<small>{source.published?'发布于 '+source.published+' · ':''}核对于 {source.checked}</small></a>)}</details>
              {shareUrl&&<label className="share-field">路线链接<input value={shareUrl} readOnly aria-label="路线分享链接" onFocus={e=>e.target.select()}/><small>本地预览链接；尚未发布到互联网。</small></label>}
            </div>
            <div className="detail-actions"><button className="primary-button" onClick={exportTrack} disabled={!selected.exportable||restricted}><Icon name="download"/>{restricted?'所选日期不适用':selected.exportable?'导出骑行轨迹':'轨迹仍在核验'}</button><button className="share-button" onClick={share} aria-label="分享这条路线"><Icon name="share"/>分享</button><p>{selected.exportable?'通用轨迹文件，可导入码表与骑行软件。':'已展示已知资料；核验完成后才能导出。'}</p></div>
          </>:<>
            <div className="panel-top"><h2>路线集</h2><span>公路车 · 骑前参考</span><span className="index-mark">{String(routes.length).padStart(2,'0')}</span></div>
            <div className="route-filters"><label className="search-field"><Icon name="search"/><input aria-label="搜索路线或地点" placeholder="寻找一段海岸、一座山…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清除搜索" onClick={()=>setSearch('')}><Icon name="close"/></button>}</label>
            <div className="filter-row"><select aria-label="按区域筛选" value={district} onChange={e=>setDistrict(e.target.value)}><option>全深圳</option>{districts.map(value=><option key={value}>{value}</option>)}</select><select aria-label="按距离筛选" value={distance} onChange={e=>setDistance(e.target.value)}>{['全部距离','20 公里以内','20 至 50 公里','50 公里以上'].map(value=><option key={value}>{value}</option>)}</select><select aria-label="按爬升筛选" value={climb} onChange={e=>setClimb(e.target.value)}>{['全部爬升','300 米以内','300 米以上','待核实'].map(value=><option key={value}>{value}</option>)}</select></div>
            <label className="track-filter"><input type="checkbox" checked={trackOnly} onChange={e=>setTrackOnly(e.target.checked)}/>只看已有轨迹的路线 <span>{visibleRoutes.length} 条</span></label></div>
            <div className="route-list" aria-label="筛选结果">{visibleRoutes.length===0?<div className="empty-state"><Icon name="map"/><h3>还没有符合条件的路线</h3><p>可以放宽距离或爬升条件。未知数据不会计作零。</p><button onClick={()=>{setSearch('');setDistrict('全深圳');setDistance('全部距离');setClimb('全部爬升');setTrackOnly(false);}}>重置筛选</button></div>:visibleRoutes.map((route,index)=><button className="route-item" key={route.id} onClick={()=>selectRoute(route.id)}><div className="route-item-caption"><span>{route.districts.join(' · ')}</span><span>{String(index+1).padStart(2,'0')}</span></div><div className="route-item-title"><h3>{route.name}</h3><Icon name="arrow"/></div><p>{route.bestFor}</p><div className="route-item-meta"><span>{distanceText(route)}</span><span>{route.intensity}</span><span className={`route-state ${route.exportable?'ready':''}`}>{route.exportable?'有轨迹':route.status==='待核'?'通行待核':'轨迹待核'}</span></div></button>)}</div>
            <div className="list-note"><span className="hollow-dot"/>实际轨迹与公开资料 · 未核实处明确标注</div>
          </>}
        </aside>}
        {!panelOpen&&!selected&&!isOverview&&<button className="route-invitation" onClick={()=>selectRoute('shenzhen-bay-main')}><span>从城市，骑向海边</span><strong>沿深圳湾骑一段<Icon name="arrow"/></strong><small>东角头至红树林 · 13.9 公里</small></button>}
        <div className="map-legend"><span className="legend-line"/>{selected?.geometry.length?'骑行路线示意':'地标微缩 · 非等比例'}<span className="map-hint">拖动平移 · 滚轮缩放</span></div>
      </div>
      <figcaption className="plate-footer"><div className="region-links"><button onClick={overview}>全深圳</button>{['南山','福田','罗湖','盐田','大鹏'].map(value=><button key={value} onClick={()=>{setDistrict(value);setSelectedId(null);setPanelOpen(true);const route=routes.find(item=>item.districts.length===1&&item.districts.some(d=>d.includes(value)))??routes.find(item=>item.districts.some(d=>d.includes(value)));if(route)selectRoute(route.id);}}>{value}</button>)}</div><div className="footer-data"><span>{stats?'地标之间，认识深圳':'正在展开微缩深圳'}</span><button onClick={()=>setSourcesOpen(true)}><Icon name="info"/>资料与致谢</button></div></figcaption>
    </figure>
    {toast&&<div className="toast" role="status">{toast}</div>}
    <dialog ref={modalRef} className="sources-dialog" onClose={()=>setSourcesOpen(false)} onClick={e=>{if(e.target===e.currentTarget)setSourcesOpen(false);}}><div className="dialog-title"><h2>资料与致谢</h2><button aria-label="关闭资料与致谢" onClick={()=>setSourcesOpen(false)}><Icon name="close"/></button></div><div className="dialog-scroll"><p>用地标锚定深圳的微缩骑行场景。山海与街区经过抽象和比例压缩，展示地标、岸线与路线的相邻关系；不会把示意位置输出为导航轨迹。场景中的天气、时间和交通是氛围模拟，不是实时出行信息。</p><p>路线资料核对日期：2026年10月8日。地图不是通行许可；临时封闭、现场标识与管理方最新通知优先。爬升缺少可靠数据时保持待核。</p><h3>地图与视觉</h3><p>真实骑行轨迹：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap 贡献者，开放数据库许可</a>。</p><p>视觉基于 <a href="https://github.com/Khalidabdi1/factory" target="_blank" rel="noreferrer">Factory</a> 的等角城市语言，参考版本 148758ae。原作致谢 ai-iso-skill（Tolga Cohce）与 Three.js。本地项目尚未公开发布。</p><h3>场景与真实轨迹</h3><p>春笋、春茧、平安金融中心等地标保留可识别的外形；普通街区、树木、海岸和山体由模型编排。画面不采用统一地理比例，也不反映逐栋建筑、实时路况或精确转弯。</p><p>路线里程和可导出的文件仍使用开放地图的原始经纬度。示意线经过简化，仅帮助辨认路线所在片区；请在码表或骑行软件中查看真实轨迹。</p><h3>路线公开资料</h3>{sourceItems.map(source=><a className="source-link" key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<small>{source.published??source.checked}</small></a>)}</div></dialog>
  </main>;
}
