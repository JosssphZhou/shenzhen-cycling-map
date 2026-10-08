"""路线内容、节点拓扑证据和轨迹产物。不会在路网断点之间补线。"""
import collections
import heapq
import json
import math
import pathlib
import re
import sys
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT.parents[1] / 'work'
CHECKED = '2026-10-08'
REFERENCE_DISTANCES = {
    'shenzhen-bay':16.2,'dasha-river':13.7,'xili-lake':16.2,'qianhai':4,
    'futian-river':6.1,'xinzhou-river':8,'taojinshan':6.59,'wutong':14.9,
    'reservoir-south':2.2,'yantian-coast':19.5,'enshang':9,'haibei-bay':3.5,
    'yinhu':11,'xiwan':6,'shiyan':20,'guangming-lake':18.8,'hongqiao':5.7,
    'fenghuang':20,'guanlan':14.2,'dashanbei':7,'pingshan-loop':2,
    'pingshan-university':8.5,
}

def distance(a, b):
    p, q = math.radians(a[1]), math.radians(b[1])
    h = math.sin((q-p)/2)**2 + math.cos(p)*math.cos(q)*math.sin(math.radians(b[0]-a[0])/2)**2
    return 6371.0088*2*math.atan2(math.sqrt(h),math.sqrt(max(0,1-h)))

def source(title, url, published=None):
    s = {'title': title, 'url': url, 'checked': CHECKED}
    if published: s['published'] = published
    return s

# 地点名用于匹配真实 OSM 对象；它们不是用于生成轨迹的手绘坐标。
CATALOG = [
 ('shenzhen-bay','南山 福田','深圳湾公园|深圳湾滨海休闲带','南海酒店一带','红树林一带','滨海铺装道，具体材质分段待核','滨海日落'),
 ('dasha-river','南山','大沙河生态长廊|大沙河绿道|大沙河','长岭陂水库','深圳湾入海口','东岸全天可骑，西岸周末及节假日禁骑','河岸长线'),
 ('xili-lake','南山','环西丽湖碧道|西丽湖绿道|西丽湖','白芒拓印','环湖主线','防滑沥青；相邻水库大坝禁骑','湖畔山色'),
 ('qianhai','南山 宝安','前海石公园|前海石','前海石公园','欢乐港湾一带','桥梁推行及道路连接待核','城市海岸'),
 ('futian-river','福田','福田河绿道|福田河|深圳中心公园','笔架山公园','滨河大道','铺装、过桥与接驳条件待核','中心城区'),
 ('xinzhou-river','福田','新洲河','北环大道','新洲河河口','空中栈道、天桥的携车条件待核','水岸绿意'),
 ('meilin','福田','梅林绿道|梅林水库','梅林水库一带','梅东道路一带','改造计划尚不能视为全线完工','林间爬坡'),
 ('talent-park','南山','人才公园|深圳人才公园','人才公园外围','深圳湾接驳处','园内跑道不等于骑行路线','城市地标'),
 ('oct','南山','华侨城生态广场|华侨城湿地|华侨城','华侨城片区','侨城公共道路','园区与市政道路权限需分开核实','街区探索'),
 ('taojinshan','罗湖','淘金山绿道|淘金山','翠湖社区','沙湾路','主线与登山支线分开；完整路面待核','水库眺望'),
 ('wutong','罗湖','梧桐绿道|梧桐山绿道|梧桐山','万佛寺驿站','横沥口水库','局部陡坡窄道，仅自有车；完整铺装待核','山林进阶'),
 ('reservoir-south','罗湖','东湖公园|深圳水库','梧桐绿道南端','连翠桥','南线连接段；不包含北侧郊野径','水库连线'),
 ('yantian-coast','盐田','盐田海滨栈道|盐田滨海栈道','古塔公园一带','揹仔角一带','市政慢行道、绿道与新栈道组合','东部海岸'),
 ('enshang','盐田','恩上水库|恩上','沙头角林场','盐田高级中学','有山路及坡道；完整路面待核','工作日山景'),
 ('longgang-river','龙岗','龙岗河','荷康路','龙岗区界','岸别、桥梁与汛期封闭需按现场确认','河流长线'),
 ('gankeng','龙岗','甘坑河|甘坑','甘坑古镇','平湖生态园','环湖休闲与山地越野场地不可混用','湖畔休闲'),
 ('dayun','龙岗','大运绿道|神仙岭水库','大运公园入口','神仙岭水库一带','官方旧资料记有沥青与透水砖；局部陡坡','城市山林'),
 ('kuichong-coast','大鹏','官湖|玫瑰海岸|土洋','揹仔角','叠福路','滨海慢行与部分接驳道路；现状围挡待核','大鹏海岸'),
 ('xindong-road','大鹏','南澳新东路','新东路','杨梅坑','市政道路及慢行设施；鹿嘴延长段不纳入','公路海景'),
 ('haibei-bay','大鹏','海贝湾|下企沙|双拥码头|畲吓','海贝湾','畲吓湾','沥青与透水砖，局部陡坡','海湾短线'),
 ('yinhu','罗湖 龙岗 福田','银湖山绿道|银湖山郊野公园|正坑水库','正坑水库入口','银湖三九宿舍入口','上下山陡峭；登顶步道不属于骑行线','山腰进阶'),
 ('xiwan','宝安','西湾红树林公园|西湾公园','西湾公园','前海公园群','桥下慢行设施；具体入口与照明待核','落日海岸'),
 ('shiyan','宝安 光明','石岩湖绿道|石岩水库|石岩湖','石岩湖环湖入口','回到起点','官方环湖骑行线；路面分段待核','环湖长线'),
 ('maozhou','光明','茅洲河','喜德盛驿站','中大深圳校区外围','独立骑行径；不进入大学校园','河畔巡航'),
 ('guangming-lake','光明','光明湖|公明水库','科学城展示中心一带','中大外围一带','湖畔骑行径；观湖云桥禁止自行车进入','湖光山色'),
 ('hongqiao','光明','虹桥公园|碧眼水库','虹桥公园','碧眼水库一带','空中虹桥不自动算作可骑；周末规则待核','公园环游'),
 ('fenghuang','光明','凤凰公园南停车场|鹅颈水','茅洲河一带','凤凰公园与大顶岭一带','大顶岭开放日期、景观桥和接驳待核','进阶环游'),
 ('guanlan','龙华','观澜河','艺术高中东门跨河桥','企坪深莞界','官方骑行道；岸别、过桥与入口待核','河岸巡航'),
 ('niuhu','龙华','牛湖水|石马径水库|长坑水库','长坑与石马径湖库','高尔夫大道一带','活动线路不能等同常态完整可骑范围','湖库探索'),
 ('yangtaishan','龙华','龙华环城绿道－阳台山段|石凹水库','石凹水库','部九窝一带','主要为透水沥青；陡坡及架空栈道待核','山林挑战'),
 ('dashanbei','坪山','大山陂公园|大山陂主题公园','大山陂骑行道入口','环湖回到起点','官方徒步与骑行双道；具体材质待核','环湖骑游'),
 ('pingshan-loop','坪山','坪山高级中学|洋母账桥|坪山河','坪山高级中学一带','经洋母账桥返回','桥梁通行与现有入口待核','河岸短环'),
 ('pingshan-university','坪山','深圳技术大学|赤坳|坪山河','坪山围','深圳技术大学外围','市政接驳与园路；不进入校园','河岸连接'),
]

def read_catalog(osm):
    rows = []
    for line in (ROOT/'docs/路线调研.md').read_text().splitlines():
        if line.startswith('| ') and not line.startswith('| 路线'):
            cells = [c.strip() for c in line.strip('|').split('|')]
            if len(cells) == 4: rows.append(cells)
    assert len(rows) == len(CATALOG) == 33
    routes, anchors = [], {}
    for row, cfg in zip(rows, CATALOG):
        rid,districts,keywords,start,end,surface,best = cfg
        matches = []
        for keyword in keywords.split('|'):
            exact = [p for p in osm['places'] if p['name'] == keyword]
            partial = [p for p in osm['places'] if keyword in p['name']]
            if exact or partial:
                matches = exact or partial
                break
        if not matches: raise ValueError(f'未找到真实定位对象: {rid} {keywords}')
        # 优先具名公园/水体，避免把同名公交站作为路线起点。
        chosen = min(matches,key=lambda p:(bool(p['tags'].get('highway')=='bus_stop'),p['type']!='way',p['id']))
        overrides={'talent-park':('node',7315141141),'maozhou':('way',268301213)}
        if rid in overrides:
            kind,oid=overrides[rid]
            chosen=next(p for p in osm['places'] if p['type']==kind and p['id']==oid)
        anchors[rid] = {k:chosen[k] for k in ('type','id','name','coordinate')}
        sources=[]
        for title,url in re.findall(r'\[([^\]]+)\]\(([^)]+)\)',row[3]):
            date=re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日',title)
            published='-'.join([date[1],date[2].zfill(2),date[3].zfill(2)]) if date else None
            sources.append(source(title,url,published))
        sources.append(source('开放地图：定位参照',f"https://www.openstreetmap.org/{chosen['type']}/{chosen['id']}"))
        name = row[0].split('，')[0]
        route = {'id':rid,'name':name,'districts':districts.split(), 'summary':row[1],
            'start':start,'end':end,'distanceKm':REFERENCE_DISTANCES.get(rid),'distanceNote':row[1]+'；该长度为公开资料的参考口径，尚非可导出轨迹实测。',
            'ascentM':None,'ascentNote':'尚无经过核对的道路高程或实测累计爬升资料。',
            'surface':surface,'roadBike':'完整线位和路面仍待核对，暂不作为已核验的公路车路线。',
            'intensity':'待核','status':'待核','restrictions':[row[2]],'bestFor':best,
            'highlights':[start,end],'anchor':chosen['coordinate'],'geometry':[],
            'geometryStatus':'待核','geometryNote':'已核对地点定位与公开介绍；完整连续轨迹待核，不导出连接直线。',
            'osmWayIds':[],'exportable':False,'sources':sources,'services':'补水、洗手间和维修点的具体位置与营业时间待核实。'}
        if rid=='enshang':route.update(weekdayOnly=True,hours='06:00至23:00')
        if rid in ('xili-lake','shiyan'):route['hours']='06:00至22:00'
        routes.append(route)
    return routes,anchors

def allowed(tags):
    if tags.get('bicycle') in ('no','private','dismount','use_sidepath') or tags.get('access') in ('no','private'):
        return False
    if tags.get('highway') in ('steps','motorway','motorway_link','construction','proposed'):
        return False
    return True

def graph_for(ways,nodes,predicate):
    graph=collections.defaultdict(list)
    for wid,way in ways.items():
        tags=way['tags']
        if not allowed(tags) or not predicate(way):continue
        ns=[str(n) for n in way['nodes']]
        oneway=tags.get('oneway:bicycle',tags.get('oneway','no'))
        for a,b in zip(ns,ns[1:]):
            if a not in nodes or b not in nodes:raise ValueError('缺失节点')
            if oneway!='-1':graph[a].append((b,distance(nodes[a],nodes[b]),int(wid)))
            if oneway not in ('yes','1','true'):graph[b].append((a,distance(nodes[a],nodes[b]),int(wid)))
    return graph

def shortest_path(graph,start,end):
    start,end=str(start),str(end)
    queue=[(0,start)];cost={start:0};prev={}
    while queue:
        length,n=heapq.heappop(queue)
        if length!=cost[n]:continue
        if n==end:break
        for nxt,d,wid in graph.get(n,[]):
            new=length+d
            if new<cost.get(nxt,float('inf')):
                cost[nxt]=new;prev[nxt]=(n,wid);heapq.heappush(queue,(new,nxt))
    if end not in cost:raise ValueError(f'真实路网未连接: {start} → {end}')
    ns=[end];ws=[]
    while ns[-1]!=start:
        n,wid=prev[ns[-1]];ns.append(n);ws.append(wid)
    return list(reversed(ns)),list(reversed(ws))

def main():
    osm=json.loads((WORK/'routes-osm.json').read_text())
    routes,anchors=read_catalog(osm)
    nodes,ways=osm['nodes'],osm['ways']
    # 后续人工选择的端点与逐段通行依据在 routes-selections.json 中留档。
    selections=json.loads((ROOT/'scripts/routes-selections.json').read_text())
    evidence={'checked':CHECKED,'license':'ODbL-1.0','source':osm['source'],'anchors':anchors,'nodes':{},'ways':{},'routes':{}}
    ready=[]
    for selection in selections:
        base=next(r for r in routes if r['id']==selection['base'])
        route=json.loads(json.dumps(base))
        route.update(selection['content'])
        selected=set(selection['wayIds'])
        graph=graph_for(ways,nodes,lambda w:w['id'] in selected)
        path=[];edgeways=[]
        for a,b in zip(selection['viaNodes'],selection['viaNodes'][1:]):
            ns,ws=shortest_path(graph,a,b)
            path.extend(ns if not path else ns[1:]);edgeways.extend(ws)
        geometry=[nodes[n] for n in path]
        km=sum(distance(a,b) for a,b in zip(geometry,geometry[1:]))
        route.update(geometry=[geometry],geometryStatus='已核对路网',exportable=True,
            distanceKm=round(km,2),distanceNote=f'按原始道路节点计算的水平长度约 {km:.2f} 公里；不含到达入口的接驳及路面高差。',
            anchor=geometry[len(geometry)//2],osmWayIds=list(dict.fromkeys(edgeways)))
        route['sources'] += [source('开放地图：真实道路与节点','https://www.openstreetmap.org/copyright'),
            source('广东开放路网下载','https://download.geofabrik.de/asia/china/guangdong.html')]
        route['sources'] += selection.get('sources',[])
        evidence['routes'][route['id']]={'nodeIds':[int(n) for n in path],'edgeWayIds':edgeways,
            'selection':selection,'distanceUnroundedKm':km}
        for n in path:evidence['nodes'][n]=nodes[n]
        for wid in edgeways:evidence['ways'][str(wid)]=ways[str(wid)]
        ready.append(route)
    routes=ready+routes
    (ROOT/'public/data').mkdir(parents=True,exist_ok=True)
    (ROOT/'public/tracks').mkdir(parents=True,exist_ok=True)
    (ROOT/'public/data/routes.json').write_text(json.dumps(routes,ensure_ascii=False,separators=(',',':'))+'\n')
    (ROOT/'public/data/routes-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,separators=(',',':'))+'\n')
    print(f'生成 {len(routes)} 条资料，{len(selections)} 条连续轨迹。')

if __name__=='__main__':main()
