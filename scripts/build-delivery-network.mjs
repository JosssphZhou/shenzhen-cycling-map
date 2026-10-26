import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const input = resolve(process.argv[2] || 'public/data/shenzhen-city.json');
const output = resolve(process.argv[3] || 'public/data/delivery-network.json');
const source = await readFile(input);
const map = JSON.parse(source);
const rawInput = resolve(process.argv[4] || '../../work/routes-osm.json');
const rawSource = await readFile(rawInput), osm = JSON.parse(rawSource);
const bounds = [113.88,22.47,114.005,22.605];
const inside = point => point && point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];
const allowed = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'living_street', 'unclassified', 'service', 'cycleway', 'footway', 'path', 'pedestrian']);
const coordinates = [], ids = new Map(), roads = [];
const node = id => {
  if (!ids.has(id)) { ids.set(id, coordinates.length); coordinates.push(osm.nodes[id]); }
  return ids.get(id);
};
const meters = (a, b) => Math.hypot((a[0] - b[0]) * 102500, (a[1] - b[1]) * 111195);
for (const road of Object.values(osm.ways)) {
  if (!allowed.has(road.tags.highway) || ['no','private'].includes(road.tags.access) || road.tags.bicycle === 'no') continue;
  for (let index = 1; index < road.nodes.length; index++) {
    if (!inside(osm.nodes[road.nodes[index - 1]]) || !inside(osm.nodes[road.nodes[index]])) continue;
    const a = node(road.nodes[index - 1]), b = node(road.nodes[index]);
    if (a !== b) roads.push([a, b]);
  }
}
const parents = coordinates.map((_, index) => index);
function root(index) { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; }
for (const [a, b] of roads) { const from = root(a), to = root(b); if (from !== to) parents[to] = from; }
const sizes = new Map();
for (let index = 0; index < coordinates.length; index++) { const id = root(index); sizes.set(id, (sizes.get(id) || 0) + 1); }
const largest = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
const nodes = [], translated = new Map();
coordinates.forEach((point, index) => { if (root(index) === largest) { translated.set(index, nodes.length); nodes.push(point); } });
const seen = new Set(), edges = [];
for (const [a, b] of roads) {
  if (!translated.has(a) || !translated.has(b)) continue;
  const from = translated.get(a), to = translated.get(b), key = `${Math.min(from, to)}:${Math.max(from, to)}`;
  if (seen.has(key)) continue;
  seen.add(key); edges.push([from, to, Math.round(meters(nodes[from], nodes[to]) * 10) / 10]);
}
const areas = [
  ['后海',113.941,22.521],['深圳湾',113.954,22.518],['科技园',113.951,22.542],['南头',113.925,22.541],
  ['蛇口',113.928,22.492],['前海',113.899,22.527],['宝安中心',113.887,22.555],['西丽',113.962,22.581],
  ['车公庙',114.024,22.535],['福田中心',114.056,22.540],['梅林',114.046,22.570],['华强北',114.086,22.546],
  ['东门',114.120,22.548],['莲塘',114.164,22.562],['沙头角',114.229,22.550],['盐田',114.254,22.579],
  ['大梅沙',114.310,22.598],['龙华',114.029,22.652],['龙岗',114.247,22.720],['坪山',114.341,22.697],
  ['光明',113.945,22.750],['大鹏',114.479,22.596],
];
function nearest(target) { let best = 0, distance = Infinity; nodes.forEach((point, index) => { const value = meters(point, target); if (value < distance) { best = index; distance = value; } }); return best; }
const shops = ['暖饭小铺','巷口面馆','早安包子','一杯茶','家常饭堂','街角小厨'];
const customers = ['写字楼取餐点','公寓取餐点','社区取餐点','园区取餐点','街坊取餐点','小区取餐点'];
const offsets = [[0,0],[.004,.002],[-.003,.004],[.005,-.003],[-.004,-.003],[.001,.006],[-.006,.001],[.006,.005],[-.005,.006],[.003,-.006],[-.007,-.004],[.008,0]];
const places = [], usedNodes = new Set();
for (const [area, longitude, latitude] of areas.filter(([,x,y]) => inside([x,y]))) offsets.forEach(([x, y], index) => {
  const at = nearest([longitude + x, latitude + y]);
  if (usedNodes.has(at)) return;
  usedNodes.add(at);
  places.push({ id: `p-${at}`, name: `${area}·${index % 2 === 0 ? shops[(index / 2) % shops.length] : customers[Math.floor(index / 2) % customers.length]}`, kind: index % 2 === 0 ? 'merchant' : 'customer', area, coordinate: nodes[at], node: at });
});
const landmarks = map.landmarks.filter(landmark => inside(landmark.coordinate)).map(landmark => {
  const area = [...areas].sort((a,b) => meters([a[1],a[2]],landmark.coordinate)-meters([b[1],b[2]],landmark.coordinate))[0][0];
  return { id:landmark.id, name:landmark.name, area, coordinate:landmark.coordinate };
});
const network = { version:1, nodes, edges, places, landmarks,
  source:'由已留存的OpenStreetMap原始道路节点提取。原型配送范围为后海、深圳湾、南头、蛇口、科技园、前海及附近街区；商家和客户为虚构取送点。仅作游戏模拟，不含完整道路通行许可判定。',
  provenance:{sourceSha256:createHash('sha256').update(rawSource).digest('hex'),landmarkMapSha256:createHash('sha256').update(source).digest('hex'),sourceUrl:osm.source,checked:osm.checked,bounds,allowedKinds:[...allowed],components:sizes.size,sourceRoads:Object.keys(osm.ways).length,nodes:nodes.length,edges:edges.length,places:places.length,coordinateSystem:'WGS84'},
};
await mkdir(dirname(output), { recursive:true });
await writeFile(output, JSON.stringify(network)+'\n');
console.log(JSON.stringify({ output, nodes:nodes.length, edges:edges.length, places:places.length, bytes:Buffer.byteLength(JSON.stringify(network)) }));
