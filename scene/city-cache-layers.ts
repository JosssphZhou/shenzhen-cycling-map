import * as THREE from 'three';
import type { BuildingTile, BuildingTileData, MapPolygon, ShenzhenMapData } from './map-types';
import type { MiniEntity } from './entities';
import { MAP_SCALE, meterProjection, type Projection } from './geographic-geometry';
import { buildBuildings, buildClippedTerrain, buildGridTerrain, buildRoads, disposeGeometry } from './city-geometry';
import { fetchCityCache } from './city-cache';

interface TileState { descriptor: BuildingTile; group: THREE.Group; buildings: MapPolygon[] | null; count: number; used: number; facade: boolean; legacy: boolean }
const noPicking = (group: THREE.Group) => group.traverse(object => { if (object instanceof THREE.Mesh) object.raycast = () => {}; });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const coordinate = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every(number => typeof number === 'number' && Number.isFinite(number));
const rings = (value: unknown): boolean => Array.isArray(value) && value.every(ring => Array.isArray(ring) && ring.length >= 3 && ring.every(coordinate));
function tileValue(value: unknown): value is BuildingTileData {
  return record(value) && Array.isArray(value.buildings) && value.buildings.every(building => record(building) && typeof building.id === 'string' && typeof building.kind === 'string' && rings(building.rings))
    && Array.isArray(value.roads) && value.roads.every(road => record(road) && typeof road.id === 'string' && typeof road.kind === 'string' && Array.isArray(road.points) && road.points.every(coordinate));
}

/** 精确几何的视野队列；远景整城批次与近景街区不同时提交给GPU。 */
export class CachedCityLayers {
  readonly group = new THREE.Group();
  private meters;
  private loaded = new Map<string, TileState>();
  private pending = new Map<string, AbortController>();
  private failed = new Map<string, number>();
  private boxes = new Map<string, THREE.Box3>();
  private globals = new Map<string, THREE.Group>();
  private globalPending = new Map<string, AbortController>();
  private globalFailed = new Set<string>();
  private facadePending = new Map<string, AbortController>();
  private terrain: THREE.Group;
  private terrainController: AbortController | null = null;
  private terrainClipped = false;
  private terrainError = false;
  private terrainRetryAt = 0;
  private disposed = false;
  private close = true;
  private lastTiles = -Infinity;
  private visible: BuildingTile[] = [];
  private visibleIds = new Set<string>();
  private bytes = 0;
  private requests = 0;
  private preloaded = 0;
  private excluded: Set<string>;
  private original: Promise<BuildingTileData> | null = null;
  private originalController: AbortController | null = null;

  constructor(private city: ShenzhenMapData, projection: Projection, private picker: MiniEntity) {
    this.group.name = '预构建深圳真实三维城市'; this.meters = meterProjection(projection);
    this.excluded = new Set(city.landmarks.map(landmark => landmark.sourceId));
    this.terrain = city.cachedGeometry?.get('terrain/grid') ?? (city.terrain ? buildGridTerrain(city.terrain, this.meters) : new THREE.Group());
    this.terrain.userData.entity = picker; this.group.add(this.terrain);
    for (const descriptor of city.buildingTiles ?? []) {
      const [w, s, e, n] = descriptor.bounds;
      this.boxes.set(descriptor.id, new THREE.Box3(projection.flat([w, n], 0), projection.flat([e, s], 35)));
      const cached = city.cachedGeometry?.get(`tile/${descriptor.id}`);
      if (cached) { this.addTile(descriptor, cached, null, descriptor.cache?.buildings ?? descriptor.count); this.preloaded++; }
    }
  }
  private addTile(descriptor: BuildingTile, group: THREE.Group, buildings: MapPolygon[] | null, count: number) {
    noPicking(group); group.traverse(object => { if (object.userData.fill === 'road' || object.userData.line) object.userData.entity = this.picker; });
    this.group.add(group); this.loaded.set(descriptor.id, { descriptor, group, buildings, count, used: performance.now(), facade: false, legacy: buildings !== null });
    group.visible = this.close && this.visibleIds.has(descriptor.id); this.failed.delete(descriptor.id);
  }
  private isVisible(descriptor: BuildingTile, camera: THREE.Camera) {
    const box = this.boxes.get(descriptor.id)!;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
    }
    return left < 1.08 && right > -1.08 && top < 1.08 && bottom > -1.08;
  }
  private async originalTile(descriptor: BuildingTile, signal: AbortSignal) {
    this.requests++; const response = await fetch(descriptor.url, { signal }); if (!response.ok) throw new Error('街区来源未载入');
    const buffer = await response.arrayBuffer(); if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const data: unknown = JSON.parse(new TextDecoder().decode(buffer)); if (!tileValue(data)) throw new Error('街区来源不完整');
    this.bytes += buffer.byteLength; return data;
  }
  private originalLayers() {
    if (this.original) return this.original;
    const controller = new AbortController(); this.originalController = controller;
    this.original = (async () => {
      this.requests++; const response = await fetch('/data/shenzhen-city.json', { signal: controller.signal }); if (!response.ok) throw new Error('全城来源未载入');
      const bytes = await response.arrayBuffer(), data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!tileValue(data)) throw new Error('全城来源不完整'); this.bytes += bytes.byteLength; return data;
    })().catch(error => { this.original = null; throw error; });
    return this.original;
  }
  private async loadTile(descriptor: BuildingTile) {
    const controller = new AbortController(); this.pending.set(descriptor.id, controller);
    let group: THREE.Group | null = null;
    try {
      let buildings: MapPolygon[] | null = null, count = descriptor.cache?.buildings ?? descriptor.count;
      if (descriptor.cache) {
        try {
          this.requests++; const cached = await fetchCityCache(descriptor.cache.url, controller.signal); this.bytes += cached.bytes;
          group = cached.groups.get(`tile/${descriptor.id}`) ?? null;
          if (!group) { cached.groups.forEach(disposeGeometry); throw new Error('街区缓存缺少建筑'); }
        } catch (error) { if (controller.signal.aborted) throw error; }
      }
      if (!group) {
        const data = await this.originalTile(descriptor, controller.signal);
        buildings = data.buildings.filter(building => !this.excluded.has(building.id)); count = buildings.length;
        group = new THREE.Group(); group.add(buildBuildings(buildings, this.meters));
        for (const road of Object.values(buildRoads(data, this.meters))) { road.userData.entity = this.picker; road.position.y = .003; group.add(road); }
      }
      if (this.disposed || controller.signal.aborted) { disposeGeometry(group); return; }
      this.addTile(descriptor, group, buildings, count); group = null;
    } catch (error) {
      if (group) disposeGeometry(group);
      if (!controller.signal.aborted && !this.disposed) this.failed.set(descriptor.id, performance.now());
    } finally {
      if (this.pending.get(descriptor.id) === controller) this.pending.delete(descriptor.id);
      this.pump();
    }
  }
  private pump() {
    if (this.disposed || !this.close) return;
    const now = performance.now();
    for (const descriptor of this.visible) {
      if (this.pending.size >= 6) break;
      if (this.loaded.has(descriptor.id) || this.pending.has(descriptor.id) || now - (this.failed.get(descriptor.id) ?? -Infinity) < 15000) continue;
      void this.loadTile(descriptor);
    }
  }
  private async loadTerrain() {
    const url = this.city.fastCity?.terrainUrl;
    if (!url || this.terrainController || this.terrainClipped || this.disposed || performance.now() < this.terrainRetryAt) return;
    const controller = new AbortController(); this.terrainController = controller;
    let terrain: THREE.Group | null = null;
    try {
      try {
        this.requests++; const cached = await fetchCityCache(url, controller.signal); this.bytes += cached.bytes;
        terrain = cached.groups.get('terrain/clipped') ?? null;
        if (!terrain) { cached.groups.forEach(disposeGeometry); throw new Error('地形缓存不完整'); }
      } catch (error) {
        if (controller.signal.aborted) throw error;
        this.requests++; const response = await fetch('/data/city-terrain.json', { signal: controller.signal }); if (!response.ok) throw new Error('地形来源未载入');
        const bytes = await response.arrayBuffer(), data: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!record(data) || !Array.isArray(data.positions) || data.positions.length % 9 || !data.positions.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('地形来源不完整');
        this.bytes += bytes.byteLength; terrain = buildClippedTerrain(data.positions, this.meters);
      }
      if (this.disposed || controller.signal.aborted) { disposeGeometry(terrain); return; }
      terrain.userData.entity = this.picker; this.group.remove(this.terrain); disposeGeometry(this.terrain); this.terrain = terrain; this.group.add(terrain);
      this.terrainClipped = true; this.terrainError = false;
    } catch { if (terrain) disposeGeometry(terrain); if (!controller.signal.aborted && !this.disposed) { this.terrainError = true; this.terrainRetryAt = performance.now() + 15000; } }
    finally { if (this.terrainController === controller) this.terrainController = null; }
  }
  private async loadGlobal(key: 'roads' | 'overview') {
    if (this.disposed || this.globalPending.has(key) || this.globals.has(key) || this.globalFailed.has(key)) return;
    const controller = new AbortController(); this.globalPending.set(key, controller);
    const group = new THREE.Group(); group.name = key === 'roads' ? '全城道路缓存' : '全城建筑概览缓存';
    try {
      try {
        this.requests++; const cached = await fetchCityCache(key === 'roads' ? this.city.fastCity!.roadsUrl : this.city.fastCity!.overviewUrl, controller.signal); this.bytes += cached.bytes;
        for (const [name, child] of cached.groups) if (key === 'roads' || name === 'overview/full') group.add(child); else disposeGeometry(child);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        const data = await this.originalLayers();
        if (this.disposed || controller.signal.aborted) return;
        if (key === 'roads') for (const road of Object.values(buildRoads(data, this.meters))) group.add(road);
        else group.add(buildBuildings(data.buildings.filter(building => !this.excluded.has(building.id)), this.meters));
      }
      if (this.disposed || controller.signal.aborted) { disposeGeometry(group); return; }
      noPicking(group); group.userData.entity = this.picker; group.visible = !this.close; this.group.add(group); this.globals.set(key, group);
    } catch { disposeGeometry(group); if (!controller.signal.aborted && !this.disposed) this.globalFailed.add(key); }
    finally { if (this.globalPending.get(key) === controller) this.globalPending.delete(key); }
  }
  private async loadFacade(state: TileState) {
    if (state.facade || this.facadePending.has(state.descriptor.id)) return;
    const controller = new AbortController(); this.facadePending.set(state.descriptor.id, controller);
    try {
      const data = state.buildings ? null : await this.originalTile(state.descriptor, controller.signal);
      if (this.disposed || controller.signal.aborted || this.loaded.get(state.descriptor.id) !== state) return;
      const buildings = state.buildings ?? data!.buildings.filter(building => !this.excluded.has(building.id));
      const detailed = buildBuildings(buildings, this.meters, true); noPicking(detailed);
      const previous = state.group.getObjectByName('真实建筑'); if (previous) { state.group.remove(previous); disposeGeometry(previous); }
      const facade = detailed.getObjectByName('立面示意细节'); if (facade) facade.visible = true;
      state.group.add(detailed); state.buildings = buildings; state.facade = true;
    } catch { if (!controller.signal.aborted && !this.disposed) this.failed.set(state.descriptor.id, performance.now()); }
    finally { if (this.facadePending.get(state.descriptor.id) === controller) this.facadePending.delete(state.descriptor.id); }
  }
  update(camera: THREE.Camera, zoom: number, width: number) {
    if (this.disposed) return;
    const now = performance.now(), close = zoom * 1200 / Math.max(320, width) > .07 / MAP_SCALE;
    if (this.close !== close) { this.close = close; this.lastTiles = -Infinity; }
    const legacyRoads = close && [...this.loaded.values()].some(state => state.legacy && this.visibleIds.has(state.descriptor.id));
    for (const [key, group] of this.globals) group.visible = !close || key === 'roads' && legacyRoads;
    const roads = this.globals.get('roads');
    if (roads) { const minor = roads.getObjectByName('街道'), paths = roads.getObjectByName('慢行道路'), rail = roads.getObjectByName('铁路'); if (minor) minor.visible = zoom > .025 / MAP_SCALE; if (paths) paths.visible = zoom > .06 / MAP_SCALE; if (rail) rail.visible = zoom > .018 / MAP_SCALE; }
    if (legacyRoads) void this.loadGlobal('roads');
    if (!close) { void this.loadGlobal('roads'); void this.loadGlobal('overview'); }
    if (!this.terrainClipped) void this.loadTerrain();
    if (now - this.lastTiles < 160) return;
    this.lastTiles = now;
    this.visible = close ? (this.city.buildingTiles ?? []).filter(tile => this.isVisible(tile, camera)) : [];
    this.visibleIds = new Set(this.visible.map(tile => tile.id));
    for (const [id, controller] of this.pending) if (!this.visibleIds.has(id)) controller.abort();
    for (const state of this.loaded.values()) {
      state.group.visible = close ? this.visibleIds.has(state.descriptor.id) : !this.globals.has('overview');
      if (state.group.visible) state.used = now;
      const facade = state.group.getObjectByName('立面示意细节'); if (facade) facade.visible = zoom > .7 / MAP_SCALE;
      const minor = state.group.getObjectByName('背景街道'), paths = state.group.getObjectByName('背景慢行道路'), rail = state.group.getObjectByName('背景铁路'); if (minor) minor.visible = zoom > .025 / MAP_SCALE; if (paths) paths.visible = zoom > .06 / MAP_SCALE; if (rail) rail.visible = zoom > .018 / MAP_SCALE;
    }
    this.visible.sort((a, b) => this.boxes.get(a.id)!.getCenter(new THREE.Vector3()).project(camera).lengthSq() - this.boxes.get(b.id)!.getCenter(new THREE.Vector3()).project(camera).lengthSq());
    this.pump();
    if (zoom > .7 / MAP_SCALE) {
      const state = [...this.loaded.values()].find(tile => tile.group.visible && !tile.facade && !this.facadePending.has(tile.descriptor.id)); if (state) void this.loadFacade(state);
    }
    const evictable = [...this.loaded.values()].filter(tile => !this.visibleIds.has(tile.descriptor.id)).sort((a, b) => a.used - b.used);
    while (this.loaded.size > Math.max(48, this.visible.length) && evictable.length) {
      const state = evictable.shift()!; this.group.remove(state.group); disposeGeometry(state.group); this.loaded.delete(state.descriptor.id); this.facadePending.get(state.descriptor.id)?.abort();
    }
  }
  retryLayers() { this.failed.clear(); this.globalFailed.clear(); this.terrainError = false; this.terrainRetryAt = 0; this.lastTiles = -Infinity; this.pump(); void this.loadTerrain(); if (!this.close) { void this.loadGlobal('roads'); void this.loadGlobal('overview'); } }
  stats() {
    const visible = [...this.loaded.values()].filter(tile => tile.group.visible), tileErrors = [...this.failed.keys()].filter(id => this.visibleIds.has(id)).length;
    const overviewReady = this.globals.has('overview');
    return {
      overviewBuildings: this.city.fastCity!.overviewBuildings, visibleOverviewBuildings: !this.close && overviewReady ? this.city.fastCity!.renderedOverviewBuildings : 0, overviewReady,
      loadedBuildings: visible.reduce((sum, tile) => sum + tile.count, 0), visibleDetailedBuildings: visible.reduce((sum, tile) => sum + tile.count, 0),
      loadedTiles: this.loaded.size, visibleTiles: visible.length, wantedTiles: this.visibleIds.size, pendingTiles: this.pending.size, tileErrors,
      terrainClipped: this.terrainClipped, layerRequests: this.requests, layerBytes: this.bytes, geometryCache: true, preloadedTiles: this.preloaded,
      globalPending: this.globalPending.size, globalReady: this.globals.size === 2,
      loadingMessage: !this.close && this.globals.size < 2 && !this.globalFailed.size ? '正在载入全城街区与道路…' : null,
      layerError: this.terrainError ? '地形细节尚未载入，正在显示概览地形。' : tileErrors ? '部分街区尚未载入，请重试。' : this.globalFailed.size ? '全城概览暂时未载入，请重试。' : null,
    };
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.terrainController?.abort(); this.originalController?.abort();
    for (const controllers of [this.pending, this.globalPending, this.facadePending]) { for (const controller of controllers.values()) controller.abort(); controllers.clear(); }
    disposeGeometry(this.group); this.group.clear(); this.loaded.clear(); this.globals.clear();
  }
}
