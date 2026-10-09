import * as THREE from 'three';
import type { BuildingTile, BuildingTileData, ClippedTerrainData, MapPolygon, ShenzhenMapData } from './map-types';
import type { MiniEntity } from './entities';
import { MAP_SCALE, meterProjection, type Projection } from './geographic-geometry';
import { buildBuildings, buildClippedTerrain, buildGridTerrain, buildRoads, disposeGeometry } from './city-geometry';

interface OverviewBucket { buildings: MapPolygon[]; full: THREE.Group; remainder?: THREE.Group; dirty: boolean }
interface LoadedTile { descriptor: BuildingTile; group: THREE.Group; buildings: MapPolygon[]; ids: string[]; used: number; facade: boolean }
const noRaycast = () => {};
const disableBuildingPicking = (group: THREE.Group) => group.traverse(object => { if (object instanceof THREE.Mesh) object.raycast = noRaycast; });

/** 归档引擎的按视野加载与 LOD，增加取消、局部概览保留及失败重试。 */
export class CityLayers {
  readonly group = new THREE.Group();
  private projection;
  private roads;
  private overview: OverviewBucket[] = [];
  private bucketsByBuilding = new Map<string, OverviewBucket>();
  private loadedIds = new Map<string, number>();
  private loaded = new Map<string, LoadedTile>();
  private pending = new Map<string, AbortController>();
  private failed = new Map<string, number>();
  private tileBoxes = new Map<string, THREE.Box3>();
  private terrain: THREE.Group | null = null;
  private terrainController: AbortController | null = null;
  private terrainClipped = false;
  private terrainError = false;
  private terrainRetryAt = 0;
  private lastTiles = -Infinity;
  private disposed = false;
  private close = false;
  private visibleIds = new Set<string>();
  private bytes = 0;
  private requests = 0;
  private excluded: Set<string>;

  constructor(private city: ShenzhenMapData, projection: Projection, private picker: MiniEntity) {
    this.group.name = '真实三维城市';
    this.projection = meterProjection(projection);
    this.excluded = new Set(city.landmarks.map(landmark => landmark.sourceId));
    if (city.terrain) {
      this.terrain = buildGridTerrain(city.terrain, this.projection);
      this.terrain.userData.entity = picker; this.group.add(this.terrain);
    }
    this.roads = buildRoads(city, this.projection);
    for (const group of Object.values(this.roads)) { group.userData.entity = picker; this.group.add(group); }
    // 概览按较大街区合批，加载一片时只重建受影响的小批次。
    const buckets = new Map<string, MapPolygon[]>();
    const [west, south, east, north] = city.bounds;
    for (const building of city.buildings ?? []) {
      if (!building.rings[0]?.length || this.excluded.has(building.id)) continue;
      const first = building.rings[0][0];
      const key = `${Math.floor((first[0] - west) / (east - west) * 10)}:${Math.floor((first[1] - south) / (north - south) * 8)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(building);
    }
    for (const [key, buildings] of buckets) {
      const full = buildBuildings(buildings, this.projection); full.name = `概览建筑 ${key}`; disableBuildingPicking(full);
      const bucket: OverviewBucket = { buildings, full, dirty: false };
      this.overview.push(bucket); this.group.add(full);
      for (const building of buildings) this.bucketsByBuilding.set(building.id, bucket);
    }
    for (const descriptor of city.buildingTiles ?? []) {
      const [w, s, e, n] = descriptor.bounds;
      this.tileBoxes.set(descriptor.id, new THREE.Box3(projection.flat([w, n], 0), projection.flat([e, s], 35)));
    }
  }
  private async loadTerrain() {
    if (!this.city.terrain || this.disposed || this.terrainController || this.terrainClipped) return;
    const controller = new AbortController(); this.terrainController = controller; this.requests++;
    try {
      const response = await fetch('/data/city-terrain.json', { signal: controller.signal });
      if (!response.ok) throw new Error('地形细节未加载');
      const text = await response.text(); if (this.disposed || controller.signal.aborted) return;
      const data = JSON.parse(text) as ClippedTerrainData;
      if (!Array.isArray(data.positions) || data.positions.length % 9 || !data.positions.every(Number.isFinite)) throw new Error('地形数据不完整');
      const terrain = buildClippedTerrain(data.positions, this.projection);
      if (this.disposed || controller.signal.aborted) { disposeGeometry(terrain); return; }
      terrain.userData.entity = this.picker;
      if (this.terrain) { this.group.remove(this.terrain); disposeGeometry(this.terrain); }
      this.terrain = terrain; this.group.add(terrain); this.terrainClipped = true; this.terrainError = false; this.bytes += new TextEncoder().encode(text).length;
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) { this.terrainError = true; this.terrainRetryAt = performance.now() + 15000; }
    } finally { if (this.terrainController === controller) this.terrainController = null; }
  }
  private isVisible(descriptor: BuildingTile, camera: THREE.Camera) {
    const box = this.tileBoxes.get(descriptor.id)!;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      left = Math.min(left, projected.x); right = Math.max(right, projected.x); top = Math.min(top, projected.y); bottom = Math.max(bottom, projected.y);
    }
    return left < 1.08 && right > -1.08 && top < 1.08 && bottom > -1.08;
  }
  private adjustIds(ids: string[], increment: number) {
    for (const id of ids) {
      const count = (this.loadedIds.get(id) ?? 0) + increment;
      if (count > 0) this.loadedIds.set(id, count); else this.loadedIds.delete(id);
      const bucket = this.bucketsByBuilding.get(id); if (bucket) bucket.dirty = true;
    }
  }
  private rebuildOverview() {
    for (const bucket of this.overview) {
      if (bucket.dirty) {
        if (bucket.remainder) { this.group.remove(bucket.remainder); disposeGeometry(bucket.remainder); }
        const remaining = bucket.buildings.filter(building => !this.loadedIds.has(building.id));
        if (remaining.length < bucket.buildings.length) {
          bucket.remainder = buildBuildings(remaining, this.projection); disableBuildingPicking(bucket.remainder); this.group.add(bucket.remainder);
        } else bucket.remainder = undefined;
        bucket.dirty = false;
      }
      bucket.full.visible = !this.close || !bucket.remainder;
      if (bucket.remainder) bucket.remainder.visible = this.close;
    }
  }
  private async loadTile(descriptor: BuildingTile) {
    const controller = new AbortController(); this.pending.set(descriptor.id, controller); this.requests++;
    try {
      const response = await fetch(descriptor.url, { signal: controller.signal });
      if (!response.ok) throw new Error('建筑分片未加载');
      const text = await response.text(); if (this.disposed || controller.signal.aborted) return;
      const data = JSON.parse(text) as BuildingTileData;
      if (!Array.isArray(data.buildings) || data.buildings.some(building => !Array.isArray(building.rings) || !building.rings[0]?.length)) throw new Error('建筑数据不完整');
      const buildings = data.buildings.filter(building => !this.excluded.has(building.id));
      // 近街景才生成逐窗细节；建筑体量与楼高始终完整显示。
      const group = new THREE.Group(); group.name = `真实建筑分片 ${descriptor.id}`;
      const buildingsGroup = buildBuildings(buildings, this.projection); disableBuildingPicking(buildingsGroup); group.add(buildingsGroup);
      if (data.roads?.length) {
        const local = buildRoads({ roads: data.roads }, this.projection);
        for (const road of Object.values(local)) { road.userData.entity = this.picker; road.position.y = .003; group.add(road); }
      }
      if (this.disposed || controller.signal.aborted) { disposeGeometry(group); return; }
      this.group.add(group); group.visible = this.close && this.visibleIds.has(descriptor.id);
      const ids = buildings.map(building => building.id);
      this.loaded.set(descriptor.id, { descriptor, group, buildings, ids, used: performance.now(), facade: false });
      this.adjustIds(ids, 1); this.failed.delete(descriptor.id); this.bytes += new TextEncoder().encode(text).length;
      this.rebuildOverview();
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.failed.set(descriptor.id, performance.now());
    } finally { if (this.pending.get(descriptor.id) === controller) this.pending.delete(descriptor.id); }
  }
  update(camera: THREE.Camera, zoom: number, _width: number, _height: number, _time: number) {
    if (this.disposed) return;
    const now = performance.now();
    this.roads.minor.visible = zoom > .025 / MAP_SCALE;
    this.roads.paths.visible = zoom > .06 / MAP_SCALE;
    this.roads.rail.visible = zoom > .018 / MAP_SCALE;
    const close = zoom * 1200 / Math.max(320, _width) > .07 / MAP_SCALE;
    if (this.close !== close) { this.close = close; this.rebuildOverview(); this.lastTiles = -Infinity; }
    // 世界成功挂载后才启动异步请求，构造中途失败不会遗留后台载入。
    if (this.city.terrain && !this.terrainClipped && !this.terrainController && now >= this.terrainRetryAt) void this.loadTerrain();
    if (now - this.lastTiles < 350) return;
    this.lastTiles = now;
    const visible = this.close ? (this.city.buildingTiles ?? []).filter(tile => this.isVisible(tile, camera)) : [];
    this.visibleIds = new Set(visible.map(tile => tile.id));
    for (const [id, controller] of this.pending) if (!this.visibleIds.has(id)) controller.abort();
    for (const state of this.loaded.values()) {
      state.group.visible = this.close && this.visibleIds.has(state.descriptor.id);
      if (state.group.visible) state.used = now;
      const facade = state.group.getObjectByName('立面示意细节'); if (facade) facade.visible = zoom > .7 / MAP_SCALE;
    }
    // 原先的20片上限会漏掉宽视野两翼。视野内全部排队，仍保持最多两片并发。
    visible.sort((a, b) => {
      const centerA = this.tileBoxes.get(a.id)!.getCenter(new THREE.Vector3()).project(camera);
      const centerB = this.tileBoxes.get(b.id)!.getCenter(new THREE.Vector3()).project(camera);
      return centerA.x * centerA.x + centerA.y * centerA.y - centerB.x * centerB.x - centerB.y * centerB.y;
    });
    for (const descriptor of visible) {
      if (this.pending.size >= 2) break;
      if (this.loaded.has(descriptor.id) || this.pending.has(descriptor.id) || now - (this.failed.get(descriptor.id) ?? -Infinity) < 15000) continue;
      void this.loadTile(descriptor);
    }
    // 放大到足以阅读立面时，每轮最多补一片原作楼层/窗格细节。
    if (zoom > .7 / MAP_SCALE) {
      const state = [...this.loaded.values()].find(tile => tile.group.visible && !tile.facade);
      if (state) {
        const previous = state.group.getObjectByName('真实建筑');
        const detailed = buildBuildings(state.buildings, this.projection, true); disableBuildingPicking(detailed);
        detailed.getObjectByName('立面示意细节')!.visible = true;
        if (previous) { state.group.remove(previous); disposeGeometry(previous); }
        state.group.add(detailed); state.facade = true;
      }
    }
    const evictable = [...this.loaded.entries()].filter(([, tile]) => !this.visibleIds.has(tile.descriptor.id)).sort((a, b) => a[1].used - b[1].used);
    while (this.loaded.size > Math.max(48, visible.length) && evictable.length) {
      const [id, tile] = evictable.shift()!; this.group.remove(tile.group); disposeGeometry(tile.group); this.loaded.delete(id); this.adjustIds(tile.ids, -1);
    }
    this.rebuildOverview();
  }
  retryLayers() { this.failed.clear(); this.terrainError = false; this.lastTiles = -Infinity; void this.loadTerrain(); }
  stats() {
    const tileErrors = [...this.failed.keys()].filter(id => this.visibleIds.has(id)).length;
    return { overviewBuildings: this.city.buildings?.length ?? 0, loadedBuildings: [...this.loaded.values()].filter(tile => tile.group.visible).reduce((sum, tile) => sum + tile.buildings.length, 0),
      loadedTiles: this.loaded.size, visibleTiles: [...this.loaded.values()].filter(tile => tile.group.visible).length,
      wantedTiles: this.visibleIds.size, pendingTiles: this.pending.size, tileErrors, terrainClipped: this.terrainClipped,
      layerRequests: this.requests, layerBytes: this.bytes,
      layerError: this.terrainError ? '地形细节尚未载入，正在显示概览地形。' : tileErrors ? '部分街区尚未载入，正在显示概览建筑。' : null };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.terrainController?.abort(); this.pending.forEach(controller => controller.abort()); this.pending.clear();
    // 全部建筑、道路和高程均用 Factory 共享材质，这里只回收自己创建的几何。
    disposeGeometry(this.group); this.group.clear(); this.loaded.clear(); this.overview.length = 0; this.loadedIds.clear(); this.bucketsByBuilding.clear();
  }
}
