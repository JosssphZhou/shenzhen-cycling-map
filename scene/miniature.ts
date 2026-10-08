import * as THREE from 'three';
import type { CyclingRoute } from '@/lib/types';
import { Part } from './factory/kernel/part';
import { W, FRONT, TOP } from './factory/kernel/iso';
import { Path } from './factory/kernel/path';
import { tree, pine, palm, lampPost, bench } from './factory/world/ground';
import { buildFlats, buildHouse, buildVilla } from './factory/world/town';
import { boxInto } from './factory/models/port';
import { buildLandmark } from './landmarks';

export type Point = [number, number];
export interface MiniZone { id: string; name: string; districts: string[]; anchor: Point; bounds: [number, number, number, number]; path: Point[] }
export interface MiniLabel { name: string; point: [number, number, number]; kind: 'district' | 'landmark' | 'water' }
export interface MiniMovement { kind: 'car' | 'person' | 'train' | 'ship' | 'bicycle'; path: Point[]; count: number; speed: number; height?: number; closed?: boolean }
export const MINI_WORLD: [number, number, number, number] = [-80, 1930, -230, 680];
export const BAY_VIEW: [number, number, number, number] = [75, 380, 95, 322];
const lakeLoop = (x: number, y: number, a: number, b: number): Point[] => Array.from({ length: 25 }, (_, i) => [x + Math.cos(i / 24 * Math.PI * 2) * a, y + Math.sin(i / 24 * Math.PI * 2) * b]);
export const ZONES: MiniZone[] = [
  { id: 'bay', name: '深圳湾', districts: ['南山'], anchor: [290, 278], bounds: [10, 520, 70, 350], path: [[45, 270], [110, 289], [175, 302], [236, 304], [310, 282], [370, 259], [431, 276], [491, 300]] },
  { id: 'futian', name: '福田', districts: ['福田'], anchor: [635, 230], bounds: [470, 825, 10, 365], path: [[510, 290], [568, 276], [617, 242], [673, 222], [730, 229], [783, 254]] },
  { id: 'luohu', name: '罗湖', districts: ['罗湖'], anchor: [945, 191], bounds: [800, 1125, -140, 285], path: [[846, 191], [919, 178], [972, 114], [1019, 54], [995, -4], [945, -24], [900, 8]] },
  { id: 'yantian', name: '盐田', districts: ['盐田'], anchor: [1325, 316], bounds: [1085, 1475, 80, 435], path: [[1130, 267], [1180, 293], [1245, 318], [1310, 325], [1370, 344], [1430, 375]] },
  { id: 'dapeng', name: '大鹏半岛', districts: ['大鹏'], anchor: [1650, 406], bounds: [1430, 1910, 100, 580], path: [[1490, 238], [1550, 278], [1595, 342], [1640, 407], [1700, 430], [1765, 464], [1810, 491]] },
  { id: 'baoan', name: '宝安', districts: ['宝安'], anchor: [145, -60], bounds: [-60, 340, -220, 90], path: lakeLoop(120, -90, 74, 45) },
  { id: 'guangming', name: '光明', districts: ['光明'], anchor: [442, -138], bounds: [285, 650, -225, 80], path: lakeLoop(438, -111, 91, 42) },
  { id: 'longhua', name: '龙华', districts: ['龙华'], anchor: [702, -86], bounds: [560, 890, -220, 90], path: [[580, -20], [630, -61], [678, -54], [718, -92], [790, -120], [840, -152]] },
  { id: 'longgang', name: '龙岗', districts: ['龙岗'], anchor: [1022, -136], bounds: [890, 1220, -225, 75], path: [[895, -92], [950, -114], [1000, -134], [1055, -129], [1110, -101], [1190, -64]] },
  { id: 'pingshan', name: '坪山', districts: ['坪山'], anchor: [1345, -37], bounds: [1175, 1510, -160, 175], path: lakeLoop(1342, -21, 76, 46) },
];
export function zoneForRoute(route: CyclingRoute) {
  const text = `${route.name} ${route.districts.join(' ')}`;
  if (/银湖/.test(route.name)) return ZONES[2];
  if (/西丽|大沙河|人才公园|深圳湾/.test(text)) return ZONES[0];
  return ZONES.find(zone => route.districts.some(district => zone.districts.some(value => district.includes(value)))) || ZONES[0];
}
export function diagramForRoute(route: CyclingRoute): { zone: MiniZone; anchor: Point; points: Point[] } {
  let zone = zoneForRoute(route);
  const openLake = Array.from({ length: 23 }, (_, i): Point => {
    const angle = -Math.PI * .45 + i / 22 * Math.PI * 1.9;
    return [120 + Math.cos(angle) * 74, -90 + Math.sin(angle) * 45];
  });
  // 屏幕示意保留真实路线的方向、开口和经过关系，绝不用于GPX。
  const paths: Record<string, Point[]> = {
    'shenzhen-bay-main': ZONES[0].path,
    'dasha-workday': [[370, 259], [365, 185], [370, 113], [345, 55], [350, -8]],
    'xili-east': [[357, 25], [378, 16], [386, 0], [378, -19], [360, -28], [348, -29]],
    'wutong-main': [[975, 76], [1010, 60], [1028, 32], [1022, 0], [1013, -24], [1000, -48]],
    'taojinshan-main': [[897, 45], [879, 10], [891, -22], [920, -43], [951, -53], [973, -49]],
    'shiyan-lake-long': openLake,
    'yinhu-main': [[795, -15], [820, 10], [810, 35], [788, 62], [808, 104]],
    'yantian-port-dameisha': [[1245, 318], [1310, 325], [1370, 344], [1430, 375]],
  };
  let points = paths[route.id] || [];
  if (route.id === 'xili-east') zone = { ...ZONES[0], bounds: [265, 425, -65, 95] };
  if (route.id === 'dasha-workday') zone = { ...ZONES[0], bounds: [255, 455, -60, 325] };
  if (route.id === 'yinhu-main' || /银湖/.test(route.name)) zone = { ...ZONES[2], anchor: [808, 55], bounds: [705, 910, -70, 165] };
  if (['wutong-main', 'taojinshan-main'].includes(route.id)) zone = { ...ZONES[2], bounds: [815, 1100, -115, 165] };
  if (!route.exportable && route.geometryStatus !== '已核对路网') points = [];
  const anchor = points.length ? points[Math.floor(points.length / 2)] : zone.anchor;
  return { zone, anchor, points };
}

function flatPolygon(part: Part, ring: Point[], tone: string, z = 0) {
  const vectors = ring.map(([x, y]) => new THREE.Vector2(x, y));
  const triangles = THREE.ShapeUtils.triangulateShape(vectors, []);
  for (const [a, b, c] of triangles) part.tri(tone, W(...ring[a], z), W(...ring[b], z), W(...ring[c], z));
}
function linePath(part: Part, points: Point[], width: number, tone: string, z = .03, edges = true) {
  const path = new Path(points, 10, false);
  for (let s = 0; s < path.length; s += 2.5) {
    const a = path.at(s)!, b = path.at(Math.min(path.length, s + 2.5))!;
    const ax = Math.sin(a.h) * width / 2, ay = -Math.cos(a.h) * width / 2;
    const bx = Math.sin(b.h) * width / 2, by = -Math.cos(b.h) * width / 2;
    part.poly(tone, [W(a.x + ax, a.y + ay, z), W(b.x + bx, b.y + by, z), W(b.x - bx, b.y - by, z), W(a.x - ax, a.y - ay, z)]);
    if (edges) { part.seg('detail', W(a.x + ax, a.y + ay, z + .01), W(b.x + bx, b.y + by, z + .01)); part.seg('detail', W(a.x - ax, a.y - ay, z + .01), W(b.x - bx, b.y - by, z + .01)); }
  }
  return path;
}
function lake(part: Part, x: number, y: number, a: number, b: number) {
  const ring = lakeLoop(x, y, a, b);
  flatPolygon(part, ring, 'sea', .09);
  for (let i = 1; i < ring.length; i++) part.seg('line', W(...ring[i - 1], .13), W(...ring[i], .13));
}
function hill(part: Part, x: number, y: number, width: number, depth: number, height: number) {
  const rings = [0, .22, .48, .72, 1].map(level => Array.from({ length: 9 }, (_, i) => {
    const angle = i / 8 * Math.PI * 2, radius = 1 - level * .88;
    return W(x + Math.cos(angle) * width * radius + level * width * .18, y + Math.sin(angle) * depth * radius, height * level);
  }));
  for (let level = 1; level < rings.length; level++) for (let i = 0; i < 8; i++) {
    part.poly('grass', [rings[level - 1][i], rings[level - 1][i + 1], rings[level][i + 1], rings[level][i]]);
    part.seg('detail', rings[level][i], rings[level][i + 1]);
    if (i % 2 === 0) part.seg('detail', rings[level - 1][i], rings[level][i]);
  }
  part.poly('grass', rings.at(-1)!);
}

export function buildMiniature() {
  const group = new THREE.Group(); group.name = '深圳地标微缩场景';
  const ground = new Part(), gardens = new Part(), streets = new Part();
  const labels: MiniLabel[] = [];
  const movements: MiniMovement[] = [];
  const coast: Point[] = [[-80, 243], [3, 270], [92, 308], [181, 330], [251, 327], [336, 301], [387, 284], [471, 322], [550, 329], [638, 311], [722, 279], [805, 265], [909, 246], [1016, 234], [1110, 274], [1192, 321], [1305, 350], [1373, 368], [1450, 402], [1510, 342], [1570, 399], [1640, 457], [1700, 465], [1770, 507], [1845, 506], [1930, 445]];
  ground.box(-80, -230, -5, 2010, 910, 4.4, 'gr', { lines: false });
  flatPolygon(ground, [[-80, -230], [1930, -230], [1930, 680], [-80, 680]], 'sea', -.6);
  const land: Point[] = [[-80, -230], [1930, -230], ...coast.toReversed()];
  flatPolygon(ground, land, 'ground', 0);
  for (let i = 1; i < coast.length; i++) ground.seg('line', W(...coast[i - 1], .05), W(...coast[i], .05));
  // 山海比例刻意压缩，地标与路线的相邻关系保留；所有背景街区均为示意。
  hill(ground, 812, 50, 47, 31, 43); hill(ground, 1065, 24, 70, 52, 85); hill(ground, 1160, 55, 58, 44, 55);
  hill(ground, 1554, 174, 69, 58, 68); hill(ground, 1675, 295, 86, 54, 95); hill(ground, 1798, 365, 49, 41, 43);
  hill(ground, 225, -132, 49, 29, 34); hill(ground, 787, -173, 65, 31, 42);
  lake(ground, 294, 230, 43, 24); lake(ground, 340, 2, 36, 19);
  lake(ground, 120, -90, 61, 33); lake(ground, 438, -111, 76, 28); lake(ground, 960, -2, 51, 31); lake(ground, 1342, -21, 62, 33);
  // 北侧林地把湾景街区与湖区连起来，保留成组林冠和低矮地形。
  hill(ground, 78, 40, 36, 23, 18); hill(ground, 246, 10, 35, 22, 16); hill(ground, 377, 51, 28, 18, 12);
  const groves = [[35, 65], [55, 87], [158, 5], [186, 17], [214, 7], [272, 27], [298, 64], [381, 75], [316, -34], [367, -33]];
  for (const [cx, cy] of groves) {
    flatPolygon(gardens, [[cx - 13, cy - 8], [cx - 6, cy - 14], [cx + 12, cy - 10], [cx + 18, cy + 3], [cx + 7, cy + 13], [cx - 12, cy + 10]], 'grass', .08);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4, radius = 3 + i * 1.1;
      tree(gardens, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 1.4 + i % 3 * .3, .1);
    }
  }
  linePath(streets, [[120, -53], [145, -23], [150, 17], [146, 50], [166, 72]], 6, 'road', .03);
  linePath(streets, [[308, 6], [286, 18], [272, 49], [264, 77], [255, 98]], 4, 'deck', .12);
  movements.push({ kind: 'car', path: [[120, -53], [145, -23], [150, 17], [146, 50], [166, 72]], count: 3, speed: 4 });
  // 公园草坪与铺装为大片留白，不用大量楼房填满场景。
  flatPolygon(gardens, [[240, 176], [315, 170], [364, 197], [355, 254], [302, 276], [244, 258], [232, 214]], 'grass', .02);
  lake(gardens, 294, 230, 43, 24);
  linePath(streets, lakeLoop(294, 230, 53, 34), 3.8, 'deck', .19);
  linePath(streets, [[350, -15], [345, 55], [370, 113], [365, 185], [370, 259]], 5, 'sea', .13);
  for (const zone of ZONES) {
    linePath(streets, zone.path, zone.id === 'bay' ? 5.2 : 4, 'deck', .2);
    labels.push({ name: zone.name, point: [zone.anchor[0], zone.anchor[1] - 35, 0], kind: 'district' });
  }
  const localRoads: Point[][] = [
    [[20, 110], [109, 128], [202, 116], [313, 122], [388, 174], [451, 209]],
    [[36, 161], [118, 181], [179, 189], [202, 227], [222, 276]],
    [[408, 84], [410, 191], [460, 240], [522, 239], [599, 204], [694, 189], [802, 216]],
    [[493, 114], [572, 117], [655, 132], [744, 142], [805, 164], [895, 155], [966, 175], [1030, 171]],
    [[1120, 201], [1194, 245], [1273, 260], [1361, 290], [1432, 343]],
    [[80, 5], [172, 34], [270, 46], [357, 51], [455, 61], [554, 55], [654, 28], [754, 15], [824, 6]],
  ];
  for (const road of localRoads) {
    const path = linePath(streets, road, 11, 'road');
    for (let s = 3; s < path.length; s += 12) { const a = path.at(s)!, b = path.at(Math.min(path.length, s + 4))!; streets.seg('detail', W(a.x, a.y, .09), W(b.x, b.y, .09)); }
    movements.push({ kind: 'car', path: road, count: 4, speed: 6 });
  }
  const rail: Point[] = [[400, 55], [550, 39], [700, -5], [830, -18], [948, 54], [1060, 128]];
  const trainPath = linePath(streets, rail, 4.5, 'road', 3.6);
  for (let s = 0; s < trainPath.length; s += 22) { const p = trainPath.at(s)!; streets.box(p.x - .55, p.y - .55, 0, 1.1, 1.1, 3.5); }
  movements.push({ kind: 'train', path: rail, count: 2, speed: 12, height: 3.6 });
  movements.push({ kind: 'person', path: ZONES[0].path, count: 14, speed: 1.2 }, { kind: 'person', path: lakeLoop(294, 230, 53, 34), count: 12, speed: 1, closed: true });
  movements.push({ kind: 'bicycle', path: ZONES[0].path, count: 8, speed: 5.5 }, { kind: 'bicycle', path: ZONES[3].path, count: 4, speed: 5 });
  movements.push({ kind: 'ship', path: [[180, 410], [430, 420], [760, 397], [1070, 358], [1310, 440]], count: 3, speed: 5, height: -.6 });
  for (let x = 37; x < 465; x += 22) {
    const p = new Path(ZONES[0].path, 10).at((x - 37) / (465 - 37) * new Path(ZONES[0].path, 10).length)!;
    palm(gardens, p.x + Math.sin(p.h) * 7, p.y - Math.cos(p.h) * 7, 1.45);
    if (x % 44 < 22) lampPost(gardens, p.x, p.y - 3.7, 0, 1);
  }
  for (const [x, y, size] of [[254, 185, 1.3], [267, 180, 1], [336, 185, 1.4], [343, 200, 1.1], [247, 251, 1.2], [325, 262, 1], [306, 171, 1.3], [51, 242, 1.4], [112, 260, 1.2], [152, 271, 1.5]]) tree(gardens, x, y, size);
  for (let i = 0; i < 28; i++) { const x = 399 + i * 3.1, y = 278 + Math.sin(i * .7) * 8 + i * .22; tree(gardens, x, y, .75 + i % 3 * .12); }
  for (const zone of ZONES.slice(5)) for (let i = 0; i < 12; i++) pine(gardens, zone.anchor[0] - 60 + i * 11, zone.anchor[1] - 45 - Math.sin(i) * 9, 1.2);
  for (const [x, y] of [[244, 240], [325, 252], [290, 189], [72, 260], [191, 291]]) bench(gardens, x, y, 's');
  // 街区铺装、树池和短路组成成组城市肌理，公园与海面继续保留大块空白。
  const blocks = [[162, 47, 77, 61], [249, 102, 75, 58], [49, 180, 80, 69], [124, 199, 87, 69]];
  for (const [x, y, width, depth] of blocks) {
    gardens.box(x, y, .04, width, depth, .14, 'gr');
    const loop: Point[] = [[x - 5, y - 5], [x + width + 5, y - 5], [x + width + 5, y + depth + 5], [x - 5, y + depth + 5], [x - 5, y - 5]];
    linePath(streets, loop, 6, 'road', .03);
    for (let i = 0; i < 5; i++) {
      const tx = x + 8 + i * (width - 16) / 4;
      tree(gardens, tx, y + depth - 3, .9 + (i % 2) * .25, .2);
      if (i % 2 === 0) lampPost(gardens, tx, y + depth + 3, 0, -1);
    }
    movements.push({ kind: 'car', path: loop, count: 2, speed: 4.5, closed: true });
    movements.push({ kind: 'person', path: [[x + 3, y + depth], [x + width - 3, y + depth]], count: 3, speed: 1 });
  }
  const parkPath = new Path(lakeLoop(294, 230, 46, 27), 0);
  for (let s = 0; s < parkPath.length; s += 3.4) {
    const a = parkPath.at(s)!, b = parkPath.at(Math.min(parkPath.length, s + 3.4))!;
    gardens.seg('line', W(a.x, a.y, .2), W(a.x, a.y, 1.15));
    gardens.seg('detail', W(a.x, a.y, .95), W(b.x, b.y, .95));
  }
  for (const [x, y] of [[264, 205], [280, 195], [333, 223], [271, 257], [312, 257], [337, 242], [347, 213], [246, 220]]) {
    bench(gardens, x, y, 's');
    tree(gardens, x + 3, y - 4, 1.2); tree(gardens, x + 6, y - 2, .9);
    lampPost(gardens, x - 2, y + 2, 0, 1);
  }
  linePath(streets, [[250, 188], [258, 204], [248, 221], [258, 255], [281, 269]], 2.1, 'deck', .22);
  linePath(streets, [[307, 175], [337, 192], [349, 224], [340, 250], [322, 266]], 2.1, 'deck', .22);
  // 跨湾桥北端连接深圳湾岸，南端向画面外延伸，不是骑行线路。
  const ramp = [[156, 299, 7.5], [188, 286, 4], [222, 276, .05]];
  for (let i = 1; i < ramp.length; i++) {
    const [ax, ay, az] = ramp[i - 1], [bx, by, bz] = ramp[i];
    const angle = Math.atan2(by - ay, bx - ax), dx = Math.sin(angle) * 6.5, dy = -Math.cos(angle) * 6.5;
    streets.poly('road', [W(ax + dx, ay + dy, az), W(bx + dx, by + dy, bz), W(bx - dx, by - dy, bz), W(ax - dx, ay - dy, az)]);
    for (const sign of [-1, 1]) streets.seg('line', W(ax + dx * sign, ay + dy * sign, az + .04), W(bx + dx * sign, by + dy * sign, bz + .04));
  }
  linePath(streets, [[35, 451], [-20, 521], [-75, 590]], 13, 'road', 7.5);
  for (const [x, y] of [[25, 464], [-10, 509], [-45, 553]]) streets.box(x - .8, y - .8, -.6, 1.6, 1.6, 8.1);
  // 真实地标是视觉主角，背景住宅直接复用原作带窗格和屋顶细节的buildFlats。
  const buildings = new THREE.Group();
  const flats: [string, number, number, number, number, number][] = [
    ['湾区公寓', 172, 56, 17, 16, 20], ['后海坊', 198, 57, 19, 14, 26], ['海岸办公', 220, 57, 12, 22, 32],
    ['滨海里', 173, 83, 22, 16, 16], ['后海', 207, 81, 23, 19, 22],
    ['人才街', 257, 111, 15, 20, 23], ['滨海苑', 281, 111, 15, 18, 30], ['后海书屋', 303, 111, 13, 18, 12],
    ['海岸咖啡', 257, 141, 17, 12, 8], ['湾区公寓', 288, 139, 26, 14, 17],
    ['南山街', 56, 191, 18, 19, 15], ['花园里', 81, 190, 16, 22, 12], ['南山居', 106, 191, 16, 17, 19],
    ['海角公寓', 136, 209, 16, 18, 20], ['骑行驿站', 160, 235, 18, 13, 8], ['滨海坊', 187, 236, 16, 19, 17],
    ['后海', 183, 147, 19, 17, 24],
    ['南山', 69, 153, 24, 20, 21], ['深圳湾', 329, 140, 24, 19, 30], ['后海', 365, 149, 20, 23, 40],
  ];
  let addedRoads = 0, addedHouses = 0;
  // 每组是一个有庭院和街边生活的小街区。建筑直接使用原作模型，地标之间留出视线。
  function block(name: string, x: number, y: number, width: number, depth: number, height: number, variant = 0) {
    gardens.box(x, y, .04, width, depth, .14, 'gr');
    const loop: Point[] = [[x - 4, y - 4], [x + width + 4, y - 4], [x + width + 4, y + depth + 4], [x - 4, y + depth + 4], [x - 4, y - 4]];
    linePath(streets, loop, 5.4, 'road'); addedRoads++;
    const slots = depth < 52
      ? [[7, 6, 18, 12, .8], [32, 6, 19, 13, 1.2], [width - 22, 7, 15, 12, .95], [8, depth - 15, 24, 8, .42], [width - 34, depth - 15, 23, 8, .52]]
      : [[7, 7, 18, 17, .8], [32, 7, 19, 20, 1.2], [width - 22, 9, 15, 18, .95], [8, depth - 24, 24, 16, .62], [width - 34, depth - 23, 23, 15, .76]];
    for (const [dx, dy, w, d, factor] of slots) flats.push([name, x + dx, y + dy, w, d, Math.round(height * factor)]);
    gardens.box(x + 34, y + depth - 18, .2, width - 70, 10, .12, 'gs');
    for (let i = 0; i < 5; i++) {
      const tx = x + 7 + i * (width - 14) / 4;
      (variant === 2 ? palm : tree)(gardens, tx, y + depth - 2, 1 + i % 2 * .25, .2);
      if (i % 2 === 0) lampPost(gardens, tx, y + depth + 1.5, 0, -1);
    }
    tree(gardens, x + 38, y + depth - 17, 1.15, .2);
    bench(gardens, x + 35, y + depth - 10, 's');
    movements.push({ kind: 'car', path: loop, count: 1, speed: 4, closed: true });
    movements.push({ kind: 'person', path: [[x + 3, y + depth], [x + width - 3, y + depth]], count: 3, speed: 1 });
  }
  block('福田街坊', 508, 145, 82, 61, 28);
  block('中心花园', 686, 57, 83, 62, 29);
  block('福田南街', 668, 237, 74, 36, 14);
  block('罗湖街坊', 834, 92, 80, 56, 26);
  block('东门街坊', 830, 198, 81, 45, 14);
  block('湖贝街坊', 968, 183, 79, 45, 18);
  block('盐田街坊', 1119, 128, 83, 61, 19, 2);
  block('港口后街', 1238, 191, 82, 58, 17, 2);
  block('海滨街坊', 1369, 239, 81, 56, 15, 2);

  function grove(cx: number, cy: number, width = 30, depth = 20, count = 15, coastal = false) {
    flatPolygon(gardens, [[cx - width, cy - depth * .6], [cx - width * .5, cy - depth], [cx + width * .7, cy - depth * .8], [cx + width, cy + depth * .3], [cx + width * .3, cy + depth], [cx - width * .9, cy + depth * .7]], 'grass', .08);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.4, radius = Math.sqrt((i + .5) / count);
      const px = cx + Math.cos(angle) * width * radius * .86, py = cy + Math.sin(angle) * depth * radius * .82;
      const plant = coastal && i % 4 === 0 ? palm : i % 3 === 0 ? pine : tree;
      plant(gardens, px, py, 1.15 + i % 4 * .22, .1);
    }
  }
  function village(name: string, x: number, y: number, coastal = false) {
    const width = 79, depth = 42;
    gardens.box(x, y, .04, width, depth, .14, 'gr');
    const road: Point[] = [[x - 5, y + depth + 3], [x + width + 5, y + depth + 3]];
    linePath(streets, road, 5.5, 'road'); addedRoads++;
    for (let i = 0; i < 3; i++) {
      const hx = x + 6 + i * 23, hy = y + 13 + i % 2 * 3;
      buildings.add(buildHouse({ x: hx, y: hy, w: 12 + i % 2, d: 10, h: 5.5 + i % 2 * 2, rh: 3, ridgeY: i % 2 === 0, dormer: i % 2 === 1, porch: true, door: 2, lotX0: hx - 3, lotX1: hx + 18, lotY1: y + depth - 3, garage: i === 0 ? 4 : 0, gardens }));
      addedHouses++;
      (coastal ? palm : tree)(gardens, hx + 16, y + depth - 1, 1.2, .2);
    }
    flats.push([name, x + width - 3, y + 13, 15, 18, coastal ? 11 : 16]);
    grove(x - 16, y + 14, 19, 20, 12, coastal);
    linePath(streets, [[x - 25, y + depth], [x - 16, y + 29], [x - 7, y + 19]], 2.2, 'deck', .21);
    for (const dx of [3, 37, 71]) { lampPost(gardens, x + dx, y + depth, 0, -1); bench(gardens, x + dx + 3, y + depth - 2, 's'); }
    movements.push({ kind: 'person', path: road, count: 3, speed: .9 }, { kind: 'car', path: road, count: 1, speed: 3.5 });
  }
  village('石岩湖畔', 24, -40);
  village('光明湖畔', 381, -60);
  village('龙华山居', 634, -48);
  village('龙岗街坊', 984, -91);
  village('坪山湖畔', 1286, 41);
  village('大鹏海边', 1479, 281, true);
  village('南澳海边', 1730, 410, true);

  // 湖岸公园与山脚林簇连接街坊，不在山体表面放置悬空建筑。
  for (const [x, y, w, d] of [[35, -112, 20, 28], [122, -165, 38, 21], [247, -49, 39, 24], [319, -114, 26, 33], [459, -177, 40, 23], [541, -84, 29, 23], [618, -151, 43, 26], [719, -142, 28, 19], [848, -111, 28, 28], [930, -165, 33, 20], [1095, -156, 42, 22], [1203, -61, 32, 30], [1353, -107, 44, 25], [1451, -2, 28, 39]]) grove(x, y, w, d, 19);
  for (const [x, y, w, d] of [[550, 83, 30, 21], [625, 257, 27, 17], [804, 99, 22, 17], [886, 60, 22, 18], [1029, 99, 25, 18], [1100, 226, 25, 18], [1294, 133, 41, 24], [1405, 172, 36, 32], [1463, 114, 20, 34], [1630, 90, 34, 23], [1677, 187, 31, 31], [1511, 376, 29, 20], [1690, 382, 42, 24], [1844, 438, 24, 20], [1793, 242, 40, 33]]) grove(x, y, w, d, 17, x > 1350);
  const connectors: Point[][] = [
    [[590, 178], [608, 178], [610, 126], [620, 114]],
    [[663, 115], [682, 126], [702, 151], [700, 187]],
    [[875, 149], [902, 153], [917, 166], [916, 190]],
    [[956, 148], [964, 166], [1004, 176]],
    [[1160, 194], [1173, 209], [1194, 245]],
    [[1280, 254], [1305, 269], [1345, 280], [1372, 293]],
    [[69, 7], [80, 18], [125, 23]],
    [[427, -11], [441, 17], [455, 61]],
    [[1330, 90], [1350, 122], [1367, 187], [1409, 230]],
    [[1518, 278], [1519, 252], [1536, 259]],
    [[1770, 457], [1780, 472], [1808, 486]],
  ];
  for (const path of connectors) { linePath(streets, path, 4, 'deck', .19); addedRoads++; }
  // 市民中心前广场留出地标轮廓；小树阵与长椅让空地有明确用途。
  gardens.box(591, 111, .04, 55, 22, .13, 'gr');
  for (const x of [596, 608, 620, 632, 642]) { tree(gardens, x, 129, .9, .2); bench(gardens, x, 124, 's'); }
  for (const [name, x, y, w, d, h] of flats) buildings.add(buildFlats(name, x, y, w, d, h, w / 2));
  for (const [x, y, ridgeY, dormer] of [[57, 225, false, true], [82, 226, true, false], [109, 223, false, true], [135, 242, true, false]] as [number, number, boolean, boolean][]) {
    buildings.add(buildHouse({ x, y, w: 11, d: 9, h: 6, rh: 3, ridgeY, dormer, porch: true, door: 2, lotX0: x - 3, lotX1: x + 17, lotY1: y + 16, garage: 4, car: [x + 15, y + 13] }));
  }
  buildings.add(buildVilla({ x: 183, y: 204, w: 30, bw: 23, bd: 15, pool: [185, 226, 10, 5], lotY1: 234, palms: [[181, 224], [211, 218]] }));
  const landmarks: [string, string, number, number, number][] = [
    ['spring-bamboo', '春笋', 225, 165, 100], ['cocoon', '春茧', 120, 81, 18], ['pingan', '平安金融中心', 635, 166, 135],
    ['civic-center', '市民中心', 620, 91, 19], ['kk100', '京基一百', 940, 131, 115], ['bay-bridge', '深圳湾大桥', 95, 375, 44],
    ['port-crane', '盐田港', 1240, 313, 46], ['beach-tower', '大梅沙', 1430, 352, 30],
  ];
  for (const [kind, name, x, y, height] of landmarks) {
    const model = buildLandmark(kind); model.position.copy(W(x, y, 0));
    if (kind === 'bay-bridge') model.rotation.y = .91;
    buildings.add(model); labels.push({ name, point: [x, y, height + 6], kind: 'landmark' });
  }
  for (const [x, y, name] of [[295, 231, '人才公园'], [438, 291, '红树林'], [340, 2, '西丽湖'], [120, -90, '石岩湖'], [950, -2, '深圳水库'], [812, 50, '银湖山'], [1065, 24, '梧桐山'], [1660, 300, '七娘山']] as [number, number, string][]) labels.push({ name, point: [x, y, name.includes('山') ? 95 : 5], kind: 'landmark' });
  labels.push({ name: '深圳湾', point: [310, 384, -.5], kind: 'water' }, { name: '大鹏湾', point: [1450, 515, -.5], kind: 'water' });
  // 盐田港的货箱、码头与船沿用原模型的细节，不填满整条海岸。
  ground.box(1200, 291, 0, 88, 45, 2, 'gr');
  const cargo = new Part();
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) boxInto(cargo, 1210 + col * 13, 299 + row * 4, 2, true, (row + col) % 3 === 0 ? 'kb' : 'nb');
  group.add(ground.build('山海示意'), gardens.build('公园与街树'), streets.build('骑行道与城市街道'), buildings, cargo.build('盐田港货箱'));
  return { group, labels, movements, roads: localRoads.length + ZONES.length + 1 + addedRoads, buildings: flats.length + landmarks.length + 5 + addedHouses };
}
