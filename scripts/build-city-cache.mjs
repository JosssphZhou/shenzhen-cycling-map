import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const target = fileURLToPath(new URL(specifier, context.parentURL));
    if (existsSync(target + '.ts')) return { url: pathToFileURL(target + '.ts').href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { makeProjection, meterProjection, buildCityBase } = await import('../scene/geographic-geometry.ts');
const { buildBuildings, buildRoads, buildClippedTerrain, buildGridTerrain, disposeGeometry } = await import('../scene/city-geometry.ts');
const { decodeCityCache } = await import('../scene/city-cache.ts');
const sourceRoot = resolve(process.argv[2] || 'public/data');
const outputRoot = resolve(process.argv[3] || 'public/data/fast-city');
await mkdir(outputRoot, { recursive: true });
await mkdir(resolve(outputRoot, 'tiles'), { recursive: true });
const citySource = await readFile(resolve(sourceRoot, 'shenzhen-city.json'));
const city = JSON.parse(citySource), projection = makeProjection(city.center, city.terrain), meters = meterProjection(projection);
const excluded = new Set(city.landmarks.map(item => item.sourceId));
const statistics = { files: [], tileBuildings: 0, tileBytes: 0, tileGzipBytes: 0, sourceSha256: createHash('sha256').update(citySource).digest('hex') };

function encode(groups) {
  const arrays = []; let cursor = 0;
  const visit = object => {
    let kind = 'group', tone = '', array = null;
    if (object.userData.line) { kind = 'line'; tone = object.userData.line; array = object.geometry.attributes.instanceStart.data.array; }
    else if (object.userData.fill) { kind = 'fill'; tone = object.userData.fill; array = object.geometry.attributes.position.array; }
    const node = { name: object.name, transform: [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()], visible: object.visible, kind, tone, offset: cursor, count: array?.length || 0, children: [] };
    if (array) { arrays.push(array); cursor += array.length; }
    node.children = object.children.map(visit); return node;
  };
  const metadata = Buffer.from(JSON.stringify({ version: 1, groups: Object.fromEntries([...groups].map(([key, group]) => [key, visit(group)])) }));
  const offset = Math.ceil((8 + metadata.length) / 4) * 4;
  const buffer = Buffer.alloc(offset + cursor * 4); buffer.writeUInt32LE(0x31474353, 0); buffer.writeUInt32LE(metadata.length, 4); metadata.copy(buffer, 8);
  const floats = new Float32Array(buffer.buffer, buffer.byteOffset + offset, cursor);
  let index = 0; for (const array of arrays) { floats.set(array, index); index += array.length; }
  return buffer;
}
async function store(name, groups) {
  const buffer = encode(groups), path = resolve(outputRoot, name);
  const decoded = decodeCityCache(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const roundtrip = encode(decoded);
  if (!buffer.equals(roundtrip)) throw new Error(`几何缓存往返不一致：${name}`);
  for (const group of decoded.values()) disposeGeometry(group);
  await writeFile(path, buffer);
  const result = { name, bytes: buffer.length, gzipBytes: gzipSync(buffer, { level: 6 }).length, geometryRoundtrip: true, sha256: createHash('sha256').update(buffer).digest('hex') };
  statistics.files.push(result);
  for (const group of groups.values()) disposeGeometry(group);
  return result;
}

const base = buildCityBase(city, projection);
base.set('terrain/grid', buildGridTerrain(city.terrain, meters));
console.log('base', await store('base.bin', base));
const roads = buildRoads(city, meters);
console.log('roads', await store('roads.bin', new Map(Object.entries(roads).map(([key, group]) => [`roads/${key}`, group]))));
const clipped = JSON.parse(await readFile(resolve(sourceRoot, 'city-terrain.json'), 'utf8'));
console.log('terrain', await store('terrain.bin', new Map([['terrain/clipped', buildClippedTerrain(clipped.positions, meters)]])));

const tileDescriptors = [], covered = new Set();
const roadBounds = city.roads.map(road => {
  const xs = road.points.map(point => point[0]), ys = road.points.map(point => point[1]);
  return { road, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});
for (const [index, descriptor] of city.buildingTiles.entries()) {
  const file = resolve(sourceRoot, descriptor.url.replace('/data/', ''));
  const tile = JSON.parse(await readFile(file, 'utf8'));
  const buildings = tile.buildings.filter(building => !excluded.has(building.id));
  for (const building of buildings) covered.add(building.id);
  const group = new THREE.Group(); group.name = `真实建筑分片 ${descriptor.id}`;
  group.add(buildBuildings(buildings, meters));
  const [w, s, e, n] = descriptor.bounds;
  const background = roadBounds.filter(item => item.bounds[0] <= e && item.bounds[2] >= w && item.bounds[1] <= n && item.bounds[3] >= s).map(item => item.road);
  for (const road of Object.values(buildRoads({ roads: background }, meters))) { road.name = `背景${road.name}`; group.add(road); }
  if (tile.roads.length) for (const road of Object.values(buildRoads({ roads: tile.roads }, meters))) { road.position.y = .003; group.add(road); }
  const cache = await store(`tiles/${descriptor.id}.bin`, new Map([[`tile/${descriptor.id}`, group]]));
  statistics.tileBuildings += buildings.length; statistics.tileBytes += cache.bytes; statistics.tileGzipBytes += cache.gzipBytes;
  tileDescriptors.push({ ...descriptor, cache: { url: `/data/fast-city/${cache.name}`, bytes: cache.bytes, buildings: buildings.length } });
  if (index % 100 === 0) console.log('tiles', index + 1, '/', city.buildingTiles.length);
}
const buckets = new Map(), [west, south, east, north] = city.bounds;
for (const building of city.buildings) {
  if (!building.rings[0]?.length || excluded.has(building.id)) continue;
  const first = building.rings[0][0], key = `${Math.floor((first[0] - west) / (east - west) * 10)}:${Math.floor((first[1] - south) / (north - south) * 8)}`;
  if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(building);
}
const overview = new THREE.Group(); overview.name = '全城概览建筑';
for (const [key, buildings] of buckets) { const group = buildBuildings(buildings, meters); group.name = `概览建筑 ${key}`; overview.add(group); }
const orphans = city.buildings.filter(building => !excluded.has(building.id) && !covered.has(building.id));
console.log('overview', await store('overview.bin', new Map([['overview/full', overview], ['overview/orphans', buildBuildings(orphans, meters)]])));
const bootstrap = { ...city, roads: [], buildings: [], buildingTiles: tileDescriptors,
  fastCity: { version: 1, baseUrl: '/data/fast-city/base.bin', roadsUrl: '/data/fast-city/roads.bin', terrainUrl: '/data/fast-city/terrain.bin', overviewUrl: '/data/fast-city/overview.bin', roadCount: city.roads.length, overviewBuildings: city.buildings.length, renderedOverviewBuildings: [...buckets.values()].reduce((sum, buildings) => sum + buildings.length, 0), overviewOrphans: orphans.length },
};
const boot = Buffer.from(JSON.stringify(bootstrap)); await writeFile(resolve(outputRoot, 'bootstrap.json'), boot);
statistics.bootstrapBytes = boot.length; statistics.bootstrapGzipBytes = gzipSync(boot).length;
statistics.geometryVersion = 1;
await writeFile(resolve(outputRoot, 'build-statistics.json'), JSON.stringify(statistics, null, 2) + '\n');
console.log(JSON.stringify({ bootstrapBytes: boot.length, bootstrapGzipBytes: statistics.bootstrapGzipBytes, tileBytes: statistics.tileBytes, tileGzipBytes: statistics.tileGzipBytes, buildings: statistics.tileBuildings, tiles: tileDescriptors.length }));
