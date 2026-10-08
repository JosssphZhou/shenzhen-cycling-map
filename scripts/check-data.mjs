import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (name) => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const routes = await load('public/data/routes.json');
const evidence = await load('public/data/routes-evidence.json');
const javascript = ts.transpileModule(await fs.readFile(path.join(root, 'lib/gpx.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createGpx, measureDistanceKm } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const ids = new Set();
let count = 0;
let points = 0;

function checkCoordinate(coordinate, label) {
  assert.equal(coordinate.length, 2, `${label} 必须使用经纬度二元组`);
  assert(coordinate.every(Number.isFinite), `${label} 坐标无效`);
  assert(coordinate[0] >= 113.74 && coordinate[0] <= 114.65, `${label} 经度不在深圳数据范围`);
  assert(coordinate[1] >= 22.43 && coordinate[1] <= 22.88, `${label} 纬度不在深圳数据范围`);
}

for (const route of routes) {
  assert(!ids.has(route.id), `重复路线标识 ${route.id}`);
  ids.add(route.id);
  checkCoordinate(route.anchor, route.name);
  assert(route.sources.length >= 2, `${route.name} 缺少来源`);
  for (const source of route.sources) {
    assert(source.title && /^https:\/\//.test(source.url), `${route.name} 来源无效`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(source.checked), `${route.name} 缺少核对日期`);
  }
  assert(route.ascentM === null, `${route.name} 尚无可靠道路高程，不应填入爬升数字`);
  assert(route.ascentNote && route.distanceNote && route.geometryNote);
  if (!route.exportable) {
    assert.throws(() => createGpx(route), /尚未核对/);
    assert.equal(route.geometry.length, 0, `${route.name} 待核路线不应出现未经核对的连接线`);
    assert(evidence.anchors[route.id], `${route.name} 缺少真实定位来源`);
    assert.deepEqual(route.anchor, evidence.anchors[route.id].coordinate);
    continue;
  }
  count++;
  assert.equal(route.geometryStatus, '已核对路网');
  assert.notEqual(route.status, '待核');
  assert.equal(route.geometry.length, 1, `${route.name} 存在断开的轨迹段`);
  const track = route.geometry[0];
  points += track.length;
  assert(track.length >= 2);
  const proof = evidence.routes[route.id];
  assert(proof, `${route.name} 缺少节点证据`);
  assert.equal(proof.nodeIds.length, track.length);
  assert.equal(proof.edgeWayIds.length, track.length - 1);
  for (let index = 0; index < track.length; index++) {
    checkCoordinate(track[index], route.name);
    assert.deepEqual(track[index], evidence.nodes[proof.nodeIds[index]], `${route.name} 坐标偏离 OSM 原节点`);
    if (!index) continue;
    const from = proof.nodeIds[index - 1];
    const to = proof.nodeIds[index];
    const way = evidence.ways[proof.edgeWayIds[index - 1]];
    assert(way, `${route.name} 缺少路段证据`);
    const tags = way.tags;
    assert(!['no', 'private', 'dismount', 'use_sidepath'].includes(tags.bicycle), `${route.name} 包含禁骑/推行路段`);
    assert(!['no', 'private'].includes(tags.access), `${route.name} 包含禁止进入路段`);
    assert(!['steps', 'motorway', 'motorway_link', 'construction', 'proposed'].includes(tags.highway), `${route.name} 包含不允许骑行的道路`);
    const forward = way.nodes.some((node, i) => node === from && way.nodes[i + 1] === to);
    const backward = way.nodes.some((node, i) => node === to && way.nodes[i + 1] === from);
    assert(forward || backward, `${route.name} 出现任意补线 ${from} → ${to}`);
    const oneway = tags['oneway:bicycle'] ?? tags.oneway;
    if (['yes', '1', 'true'].includes(oneway)) assert(forward, `${route.name} 逆行`);
    if (oneway === '-1') assert(backward, `${route.name} 逆行`);
  }
  const measured = measureDistanceKm(route.geometry);
  assert(Math.abs(measured - route.distanceKm) <= 0.0051, `${route.name} 距离不是原始几何计算值`);
  assert.deepEqual([...new Set(proof.edgeWayIds)], route.osmWayIds);
  const gpx = createGpx(route);
  const exported = [...gpx.matchAll(/<trkpt lat="([^\"]+)" lon="([^\"]+)" \/>/g)]
    .map((match) => [Number(match[2]), Number(match[1])]);
  assert.deepEqual(exported, track, `${route.name} GPX 坐标或顺序不一致`);
  assert(!gpx.includes('<ele>') && !gpx.includes('<time>'), `${route.name} 不应编造高程或时间`);
  assert.equal(await fs.readFile(path.join(root, 'public/tracks', `${route.id}.gpx`), 'utf8'), gpx);
  assert.throws(() => createGpx({ ...route, exportable: false }), /尚未核对/);
  assert.throws(() => createGpx({ ...route, geometry: [track, track] }), /断点/);
  assert.throws(() => createGpx({ ...route, geometry: [[[NaN, 22.6], ...track.slice(1)]] }), /坐标无效/);
  assert.throws(() => createGpx({ ...route, distanceKm: route.distanceKm + 1 }), /距离/);
}
const staticTracks = (await fs.readdir(path.join(root, 'public/tracks'))).filter((name) => name.endsWith('.gpx'));
assert.equal(staticTracks.length, count, '存在不对应当前可导出路线的 GPX');
assert(count > 0, '没有可导出的真实轨迹');
console.log(`路线校验通过：${routes.length} 条资料，${count} 条连续轨迹，${points} 个原始坐标；禁导出、拓扑、方向、来源、距离与 GPX 一致性均通过。`);
