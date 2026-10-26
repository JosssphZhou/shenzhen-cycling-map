import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Coordinate, CyclingRoute } from '@/lib/types';
import type { DeliverySceneState } from '@/lib/delivery/scene-contract';
import type { SceneController, SceneSelection, SceneSnapshot } from './contract';
import { Palette, nightAmount } from './palette';
import { W } from './factory/kernel/iso';
import { TEXT_MESHES, setTextFar } from './factory/kernel/part';
import { TEXT, LINE, applyTheme } from './factory/theme';
import { buildRain } from './factory/world/weatherfx';
import { buildGeographicScene } from './geographic';
import type { ShenzhenMapData } from './map-types';
import { ExactPath, terrainSegment, type MiniEntity, type Bounds, type Point } from './entities';
import { CityDynamics } from './dynamics';
import { DeliveryLayer } from './delivery';
import { CityWeather, buildCityFog } from './interaction-weather';

interface ViewGoal { zoom: number; target?: THREE.Vector3 }
const ISO = new THREE.Vector3(1, 1, 1).normalize();
const lines = LINE as Record<string, LineMaterial>;
const clamp = THREE.MathUtils.clamp;
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"]');

/** Factory yard/view.ts 的镜头、拾取、浮签和时间交互，内容由深圳实体提供。 */
export class CityEngine implements SceneController {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 9000);
  readonly controls!: OrbitControls;
  readonly palette!: Palette;
  private world!: ReturnType<typeof buildGeographicScene> & {
    updateLabels?: (zoom: number, camera: THREE.Camera, width: number, height: number) => void;
    update?: (camera: THREE.Camera, zoom: number, width: number, height: number, time: number) => void;
    surfaceHeight?: (point: Point) => number; terrainStep?: number;
    stats?: () => Record<string, unknown>; retryLayers?: () => void; dispose?: () => void;
  };
  private dynamics!: CityDynamics;
  private delivery: DeliveryLayer | null = null;
  private rain!: ReturnType<typeof buildRain>;
  private fog!: ReturnType<typeof buildCityFog>;
  private weather = new CityWeather();
  private routes: CyclingRoute[] = [];
  private selected: MiniEntity | null = null;
  private routeSelection: CyclingRoute | null = null;
  private selectionRevision = 0;
  private hovered: MiniEntity | null = null;
  private following = false;
  private paused = false;
  private width = 1; private height = 1;
  private fitZoom = 1; private baseZoom = 1;
  private home = new THREE.Vector3();
  private goal: ViewGoal | null = null;
  private sized = false;
  private frameId = 0; private disposed = false; private contextLost = false;
  private lastTime = performance.now(); private simTime = 80; private accumulator = 0; private cardTime = 0;
  private shift = { h: 0, goal: 0 };
  private frameCount = 0; private fps = 0; private fpsSince = performance.now(); private lastRenderMs = 0;
  private observer!: ResizeObserver;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private systemTheme = window.matchMedia('(prefers-color-scheme: light)');
  private afterDark = false; private turnTimer = 0;
  private ray = new THREE.Raycaster(); private ndc = new THREE.Vector2(); private box = new THREE.Box3();
  private down: { x: number; y: number; t: number } | null = null;
  private pointer: [number, number] | null = null; private hoverDirty = false;
  private reticle!: LineSegments2; private routeLine!: LineSegments2; private reticleKey = '';
  private routeNext: { point: THREE.Vector3; name: string } | null = null;
  private tagHover: HTMLElement; private tagSel: HTMLElement; private tagStop: HTMLElement; private note: HTMLElement;
  private reported = new Set<string>();
  private registeredTexts = new Set<THREE.Object3D>();
  private registeredTextMaterials = new Set<THREE.MeshBasicMaterial>();
  private layerNote = '';
  private maximumHeight = 50;

  constructor(private canvas: HTMLCanvasElement, private stage: HTMLElement, private onSnapshot: (snapshot: SceneSnapshot) => void, data: ShenzhenMapData, routes: CyclingRoute[], private mapMetrics: { requests: number; bytes: number }) {
    this.tagHover = stage.querySelector('#tagHover')!; this.tagSel = stage.querySelector('#tagSel')!;
    this.tagStop = stage.querySelector('#tagStop')!; this.note = stage.querySelector('#note')!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // WebGL 创建成功后才分配城市模型。文字的全局登记也需要在半途失败时回收。
    const previousTexts = new Set<THREE.Object3D>(TEXT_MESHES);
    const previousMaterials = new Set<THREE.MeshBasicMaterial>((Object.values(TEXT) as THREE.MeshBasicMaterial[][]).flat());
    const collectRegisteredText = () => {
      for (const text of TEXT_MESHES as THREE.Object3D[]) if (!previousTexts.has(text)) this.registeredTexts.add(text);
      for (const materials of Object.values(TEXT) as THREE.MeshBasicMaterial[][]) for (const material of materials) if (!previousMaterials.has(material)) this.registeredTextMaterials.add(material);
    };
    try {
      this.palette = new Palette();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0x000000, 0);
      this.routes = routes;
      const terrainHeights = data.terrain?.values || [];
      const highestGround = terrainHeights.reduce((maximum, height) => Math.max(maximum, height), 0) * .02;
      const highestBuilding = (data.buildings || []).reduce((maximum, building) => Math.max(maximum, building.height || 12), 0) * .02;
      this.maximumHeight = Math.max(50, highestGround + highestBuilding);
      this.world = buildGeographicScene(data, routes); this.scene.add(this.world.group);
      const bounds = this.world.bounds;
      const center = W((bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, 0);
      this.camera.position.copy(center).addScaledVector(ISO, 5000); this.camera.lookAt(center);
      this.controls = new OrbitControls(this.camera, canvas);
      Object.assign(this.controls, { enableRotate: false, screenSpacePanning: true, zoomToCursor: true, enableDamping: !this.reduced, dampingFactor: .12 });
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      this.controls.target.copy(center); this.controls.listenToKeyEvents(window);
      this.dynamics = new CityDynamics(this.world.movements, this.world); this.scene.add(this.dynamics.group);
      this.rain = buildRain(); this.scene.add(this.rain.group);
      this.fog = buildCityFog(this.world.bounds); this.scene.add(this.fog.group);
      this.reticle = this.overlay(); this.routeLine = this.overlay();
      this.controls.addEventListener('change', this.changed);
      canvas.addEventListener('wheel', this.wheel, { passive: true });
      canvas.addEventListener('pointerdown', this.pointerDown); canvas.addEventListener('pointerup', this.pointerUp);
      canvas.addEventListener('pointermove', this.pointerMove); canvas.addEventListener('pointerleave', this.pointerLeave);
      canvas.addEventListener('pointercancel', this.pointerCancel);
      canvas.addEventListener('webglcontextlost', this.lost); canvas.addEventListener('webglcontextrestored', this.restored);
      window.addEventListener('keydown', this.guardEditable, true); window.addEventListener('keydown', this.keyDown);
      this.systemTheme.addEventListener('change', this.themeChanged);
      document.addEventListener('visibilitychange', this.visibility);
      this.observer = new ResizeObserver(this.resize); this.observer.observe(stage);
      this.resize(); this.note.hidden = true; this.refresh(); this.frameId = requestAnimationFrame(this.animate);
      collectRegisteredText();
    } catch (error) {
      collectRegisteredText(); this.dispose(); throw error;
    }
  }
  private overlay() {
    const line = new LineSegments2(new LineSegmentsGeometry(), lines.live);
    line.raycast = () => {}; line.frustumCulled = false; line.visible = false; this.scene.add(line); return line;
  }
  private frame(bounds: Bounds, heights?: [number, number]): ViewGoal {
    const [x0, x1, y0, y1, ...zr] = bounds, [z0, z1] = heights || (zr.length ? zr : [0, 12]);
    this.camera.updateMatrixWorld(); const box = new THREE.Box3();
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) box.expandByPoint(W(x, y, z).applyMatrix4(this.camera.matrixWorldInverse));
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorld);
    return { zoom: Math.min(this.width / (box.max.x - box.min.x), this.height / (box.max.y - box.min.y)) * .94, target: center.addScaledVector(ISO, -center.y / ISO.y) };
  }
  private placeFrame(index: number): ViewGoal {
    const view = this.frame(this.world.views[index]);
    if (index === 0 && this.width < 600) view.zoom = Math.min(view.zoom * 2.2, this.controls.maxZoom);
    return view;
  }
  private resize = () => {
    const width = this.stage.clientWidth, height = this.stage.clientHeight; if (!width || !height) return;
    this.width = width; this.height = height; this.renderer.setSize(width, height, false);
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    const frame = this.frame(this.world.bounds, [-4, this.maximumHeight]); this.fitZoom = frame.zoom; this.home.copy(frame.target!);
    this.baseZoom = this.frame([this.world.bounds[0], this.world.bounds[0] + (this.world.bounds[1] - this.world.bounds[0]) * .54, this.world.bounds[2], this.world.bounds[3]], [-4, this.maximumHeight]).zoom;
    this.controls.minZoom = this.fitZoom * .6; this.controls.maxZoom = this.baseZoom * 36;
    if (!this.sized) { this.sized = true; const first = this.placeFrame(0); this.camera.zoom = first.zoom; this.moveTarget(first.target!); }
    this.camera.zoom = clamp(this.camera.zoom, this.controls.minZoom, this.controls.maxZoom); this.camera.updateProjectionMatrix();
    this.palette.resize(width, height); this.delivery?.resize(width, height); this.hoverDirty = true;
  };
  private moveTarget(target: THREE.Vector3) { const delta = target.clone().sub(this.controls.target); this.controls.target.add(delta); this.camera.position.add(delta); }
  overview() { this.setFollow(false); this.goal = { zoom: this.fitZoom, target: this.home.clone() }; }
  goView(index: number) { if (!this.world.views[index]) return; this.setFollow(false); this.goal = this.placeFrame(index); }
  zoomBy(factor: number) { this.goal = { zoom: clamp((this.goal?.zoom ?? this.camera.zoom) * factor, this.controls.minZoom, this.controls.maxZoom), target: this.goal?.target }; }
  setRoutes(routes: CyclingRoute[]) { this.routes = routes; }
  private entities() { return [...this.world.entities, ...this.dynamics.entities, ...(this.delivery?.entities ?? [])]; }
  setDelivery(state: DeliverySceneState | null) {
    if (!state) {
      if (!this.delivery) return;
      if (this.selected && this.delivery.entities.includes(this.selected)) this.clearSelection();
      this.scene.remove(this.delivery.group); this.delivery.dispose(); this.delivery = null;
      return;
    }
    if (this.delivery) this.delivery.setState(state);
    else { this.delivery = new DeliveryLayer(this.world, state); this.delivery.resize(this.width, this.height); this.scene.add(this.delivery.group); }
  }
  focusDelivery() {
    if (!this.delivery) return;
    this.select(this.delivery.entity); this.setFollow(false);
    const { bounds, heights } = this.delivery.extent();
    this.goal = this.frame(bounds, heights);
    this.goal.zoom = clamp(this.goal.zoom, this.controls.minZoom, this.controls.maxZoom);
  }
  followDelivery() {
    if (!this.delivery) return;
    this.select(this.delivery.entity);
    this.goal = { zoom: clamp(Math.min(this.width, this.height) / (this.width < 600 ? 65 : 100), this.controls.minZoom, this.controls.maxZoom) };
    this.setFollow(true);
  }
  private followTarget() {
    const selected = this.selected;
    if (!selected) return this.controls.target;
    const center = this.bounds(selected).getCenter(new THREE.Vector3());
    center.addScaledVector(ISO, -center.y / ISO.y);
    if (selected !== this.delivery?.entity) return center;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1); up.y = 0;
    if (this.width >= 700) center.addScaledVector(right, Math.min(145, this.width * .12) / this.camera.zoom);
    else if (up.lengthSq()) center.addScaledVector(up, -this.height * .18 / this.camera.zoom / up.lengthSq());
    return center;
  }
  private setLive(entity: MiniEntity | null, on: boolean) {
    if (!entity) return;
    const walk = (object: THREE.Object3D) => {
      if (object.userData.entity && object.userData.entity !== entity) return;
      if (object instanceof LineSegments2 && object.userData.line === 'line') object.material = on ? lines.live : lines.line;
      object.children.forEach(walk);
    };
    entity.groups.forEach(walk);
  }
  private bounds(entity: MiniEntity) {
    this.box.makeEmpty(); if (entity.bbox) return this.box.copy(entity.bbox());
    for (const group of entity.groups) this.box.expandByObject(group);
    return this.box;
  }
  private select(entity: MiniEntity | null, route: CyclingRoute | null = null) {
    if (entity?.routeId && !route) { const known = this.routes.find(candidate => candidate.id === entity.routeId); if (known) { this.selectRoute(known); return; } }
    if (entity && entity === this.selected) return;
    this.selectionRevision++;
    this.setLive(this.selected, false); this.selected = entity; this.routeSelection = route;
    this.setLive(entity, true); this.following = false; this.refresh(); this.drawRoute();
  }
  clearSelection() { this.select(null); this.canvas.focus(); }
  selectRoute(route: CyclingRoute | null) {
    if (!route) { this.clearSelection(); return; }
    if (route.id === this.routeSelection?.id) return;
    const segments = route.exportable && route.geometryStatus === '已核对路网' ? route.geometry.map(segment => segment.map(coordinate => this.world.project(coordinate))) : [];
    const paths = segments.filter(segment => segment.length > 1).map(segment => new ExactPath(segment)).filter(path => path.length > 0);
    const middlePath = paths[Math.floor(paths.length / 2)], middle = middlePath?.at(middlePath.length / 2);
    const anchor: Point = middle ? [middle.x, middle.y] : this.world.project(route.anchor), endpoint = segments.filter(segment => segment.length > 1).at(-1)?.at(-1);
    const entity: MiniEntity = {
      id: route.id, routeId: route.id, kind: '骑行路线', title: route.name, groups: [], relatedRouteIds: [], followable: false,
      bbox: () => { const height = this.surfaceHeight(anchor); return new THREE.Box3(W(anchor[0] - 2, anchor[1] - 2, height), W(anchor[0] + 2, anchor[1] + 2, height + 2)); },
      info: () => ({ title: route.name, status: route.status, rows: [['里程', route.distanceKm === null ? '待核对' : `${route.distanceKm.toFixed(2)} 公里`], ['爬升', route.ascentM === null ? '待核对' : `${route.ascentM} 米`], ['路面', route.surface], ['公路车', route.roadBike]] }),
      ...(paths.length ? { route: () => ({ paths, s: 0, closed: false, ...(endpoint ? { next: { x: endpoint[0], y: endpoint[1], name: route.end } } : {}) }) } : {}),
    };
    this.select(entity, route);
  }
  focusSelection() {
    if (!this.selected) return;
    this.setFollow(false);
    if (this.routeSelection) {
      const bounds = this.world.routeBounds.get(this.routeSelection.id);
      const geometry = this.routeSelection.geometryStatus === '已核对路网' ? this.routeSelection.geometry.flat() : [];
      const coordinates = geometry.length ? geometry : [this.routeSelection.anchor];
      const heights = coordinates.map(coordinate => this.surfaceHeight(this.world.project(coordinate)));
      const range: [number, number] = [Math.min(...heights) - .5, Math.max(...heights) + 2];
      if (bounds) this.goal = this.frame(bounds, range);
      else { const anchor = this.world.project(this.routeSelection.anchor); this.goal = this.frame([anchor[0] - 30, anchor[0] + 30, anchor[1] - 30, anchor[1] + 30], range); }
    }
    else {
      const box = this.bounds(this.selected), margin = Math.max(10, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * .3);
      this.goal = this.frame([box.min.x - margin, box.max.x + margin, box.min.z - margin, box.max.z + margin], [box.min.y, box.max.y]);
    }
  }
  private surfaceHeight(point: Point) { return this.world.surfaceHeight?.(point) ?? 0; }
  private hit(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    for (const hit of this.ray.intersectObjects(this.scene.children, true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      let visible = true; for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (!node.visible) visible = false;
      if (!visible || hit.point.x < this.world.bounds[0] || hit.point.x > this.world.bounds[1] || hit.point.z < this.world.bounds[2] || hit.point.z > this.world.bounds[3]) continue;
      let object: THREE.Object3D | null = hit.object; while (object && !object.userData.entity) object = object.parent;
      const entity = object?.userData.entity as MiniEntity | undefined;
      return entity ? entity.resolve ? entity.resolve(hit.point) : entity : null;
    }
    return null;
  }
  private setFollow(on: boolean) { const next = on && !!this.selected?.followable; if (next === this.following) return; this.following = next; this.refresh(); }
  toggleFollow() { this.setFollow(!this.following); }
  cycle(direction: number) {
    const moving = this.dynamics.entities.filter(entity => entity.followable).sort((a, b) => a.id.localeCompare(b.id));
    const index = moving.findIndex(entity => entity === this.selected); if (moving.length) this.select(moving[index < 0 ? (direction > 0 ? 0 : moving.length - 1) : (index + direction + moving.length) % moving.length]);
  }
  togglePause() { this.paused = !this.paused; this.refresh(); }
  private theme(): 'light' | 'dark' { return document.documentElement.dataset.theme === 'light' ? 'light' : document.documentElement.dataset.theme === 'dark' ? 'dark' : this.systemTheme.matches ? 'light' : 'dark'; }
  toggleTheme() {
    const next = this.theme() === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = next; applyTheme();
    try { localStorage.setItem('shenzhen-yard-theme', next); } catch { /* 隐私窗口仅保留本次选择。 */ }
    this.refresh();
  }
  skipTime() { this.shift.goal += 6; }
  private hour() { return ((4 + 2 / 3 + this.simTime * 24 / 360 + this.shift.h) % 24 + 24) % 24; }
  private activeView() {
    const target = this.controls.target; if (this.camera.zoom <= this.fitZoom * 1.3) return null;
    let index: number | null = null, best = Infinity;
    this.world.views.forEach(([x0, x1, y0, y1, z0 = 0, z1 = 12], k) => {
      const middle = (z0 + z1) / 2, distance = Math.hypot((x0 + x1) / 2 - middle - target.x, (y0 + y1) / 2 - middle - target.z);
      if (target.x >= x0 - middle && target.x <= x1 - middle && target.z >= y0 - middle && target.z <= y1 - middle && distance < best) { best = distance; index = k; }
    }); return index;
  }
  private selection(): SceneSelection | null {
    const entity = this.selected; if (!entity) return null;
    const info = entity.info?.();
    return { id: entity.id, kind: entity.kind, title: info?.title || entity.title, status: info?.status || '深圳地标', rows: info?.rows || [], followable: !!entity.followable, following: this.following, routeId: this.routeSelection?.id, relatedRouteIds: entity.relatedRouteIds };
  }
  private refresh() {
    const selection = this.selection(), minutes = Math.floor(this.hour() * 60) % 1440;
    this.onSnapshot({ selection, selectionRevision: this.selectionRevision, clock: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, phase: [this.afterDark ? '夜晚' : '', this.weather.word()].filter(Boolean).map(word => ` · ${word}`).join(''), paused: this.paused, theme: this.theme(), activeView: this.activeView(), readout: `${this.paused ? '已暂停 · ' : ''}${selection ? `${selection.title} · ${selection.status}` : '未选择对象'}` });
  }
  private screenAt(point: THREE.Vector3): [number, number] { const screen = point.clone().project(this.camera); return [(screen.x + 1) / 2 * this.width, (1 - screen.y) / 2 * this.height]; }
  private anchor(entity: MiniEntity) { const box = this.bounds(entity); return this.screenAt(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2)); }
  private placeAt(element: HTMLElement, [x, y]: [number, number], text: string) {
    element.hidden = false; if (element.textContent !== text) element.textContent = text;
    const halfWidth = element.offsetWidth / 2 + 6;
    element.style.left = `${clamp(x, halfWidth, this.width - halfWidth)}px`; element.style.top = `${clamp(y, element.offsetHeight + 16, this.height)}px`;
  }
  private placeTag(element: HTMLElement, entity: MiniEntity | null, text: string) { if (!entity) element.hidden = true; else this.placeAt(element, this.anchor(entity), text); }
  private updateReticle() {
    if (!this.selected) { this.reticle.visible = false; return; }
    const box = this.bounds(this.selected), x0 = box.min.x - .8, z0 = box.min.z - .8;
    const width = box.max.x + .8 - x0, depth = box.max.z + .8 - z0, length = Math.min(3, width / 3, depth / 3), positions: number[] = [];
    const height = (x: number, z: number) => this.routeSelection ? this.surfaceHeight([x0 + x, z0 + z]) + .06 : Math.max(box.min.y, this.surfaceHeight([x0 + x, z0 + z])) + .06;
    for (const [x, dx] of [[0, 1], [width, -1]]) for (const [z, dz] of [[0, 1], [depth, -1]]) {
      positions.push(x, height(x, z), z, x + dx * length, height(x + dx * length, z), z, x, height(x, z), z, x, height(x, z + dz * length), z + dz * length);
    }
    const key = positions.map(value => value.toFixed(3)).join('|');
    if (key !== this.reticleKey) { this.reticleKey = key; this.reticle.geometry.dispose(); this.reticle.geometry = new LineSegmentsGeometry().setPositions(positions); }
    this.reticle.position.set(x0, 0, z0); this.reticle.visible = true;
  }

  private drawRoute() {
    const route = this.selected?.route?.(), paths = route?.paths ?? (route?.path ? [route.path] : []);
    if (!route || !paths.some(path => path.length)) { this.routeLine.visible = false; this.routeNext = null; return; }
    const z = .24, positions: number[] = [];
    const append = (a: Point, b: Point) => positions.push(...terrainSegment(a, b, point => this.surfaceHeight(point), Math.min(.4, (this.world.terrainStep ?? 1.6) / 4), z));
    for (const path of paths) {
      if (!path.length) continue;
      const start = route.reverse ? 0 : route.s ?? 0, end = route.reverse ? route.s : route.closed ? start + path.length : path.length;
      for (let distance = start; distance < end; distance += 1.6) {
        const until = Math.min(distance + .8, end);
        if (path instanceof ExactPath) {
          for (const [a, b] of path.segmentsBetween(distance, until)) append(a, b);
        } else { const a = path.at(distance)!, b = path.at(until)!; append([a.x, a.y], [b.x, b.y]); }
      }
    }
    this.routeNext = route.next ? { point: W(route.next.x, route.next.y, this.surfaceHeight([route.next.x, route.next.y]) + z), name: route.next.name || '' } : null;
    if (route.next) {
      const radius = this.selected?.kind === '行人' ? 1.1 : 3.2;
      for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2, b = (i + 1) / 32 * Math.PI * 2; append([route.next.x + Math.cos(a) * radius, route.next.y + Math.sin(a) * radius], [route.next.x + Math.cos(b) * radius, route.next.y + Math.sin(b) * radius]); }
    }
    this.routeLine.geometry.dispose(); this.routeLine.geometry = new LineSegmentsGeometry().setPositions(positions); this.routeLine.visible = true;
  }
  private markNight(amount: number) {
    if (this.afterDark ? amount > .45 : amount < .55) return;
    this.afterDark = !this.afterDark; const root = document.documentElement; root.classList.add('turning'); root.classList.toggle('after-dark', this.afterDark);
    clearTimeout(this.turnTimer); this.turnTimer = window.setTimeout(() => root.classList.remove('turning'), 1300);
  }
  private changed = () => { this.hoverDirty = true; };
  private wheel = () => { this.goal = null; };
  private pointerDown = (event: PointerEvent) => { this.down = { x: event.clientX, y: event.clientY, t: performance.now() }; };
  private pointerUp = (event: PointerEvent) => {
    if (this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < 6 && performance.now() - this.down.t < 700) this.select(this.hit(event.clientX, event.clientY));
    this.down = null;
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) >= 6) { this.goal = null; this.setFollow(false); }
    if (event.pointerType === 'mouse' && !event.buttons) { this.pointer = [event.clientX, event.clientY]; this.hoverDirty = true; }
  };
  private pointerLeave = () => { this.pointer = null; this.hovered = null; this.canvas.classList.remove('over'); };
  private pointerCancel = () => { this.down = null; };
  private guardEditable = (event: KeyboardEvent) => { if (editable(event.target) && event.key.startsWith('Arrow')) event.stopImmediatePropagation(); };
  private keyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
    if ((event.key === ' ' || event.key === 'Enter') && event.target instanceof Element && event.target.closest('button,summary')) return;
    if (event.key.startsWith('Arrow')) { this.goal = null; this.setFollow(false); return; }
    const views = '123456789pevos', index = views.indexOf(event.key.toLowerCase());
    const actions: Record<string, () => void> = { Escape: () => this.clearSelection(), f: () => this.toggleFollow(), F: () => this.toggleFollow(), ']': () => this.cycle(1), '[': () => this.cycle(-1), ' ': () => this.togglePause(), '+': () => this.zoomBy(1.4), '=': () => this.zoomBy(1.4), '-': () => this.zoomBy(1 / 1.4), '_': () => this.zoomBy(1 / 1.4), '0': () => this.overview(), Home: () => this.overview(), t: () => this.toggleTheme(), T: () => this.toggleTheme(), n: () => this.skipTime(), N: () => this.skipTime() };
    const action = actions[event.key] || (index >= 0 && event.key.length === 1 ? () => this.goView(index) : null);
    if (action) { action(); event.preventDefault(); }
  };
  private themeChanged = () => { applyTheme(); this.refresh(); };
  private visibility = () => { this.lastTime = performance.now(); };
  private lost = (event: Event) => { event.preventDefault(); this.contextLost = true; this.layerNote = ''; this.note.removeAttribute('style'); this.note.hidden = false; this.note.textContent = '正在重新绘制场景…'; };
  private restored = () => { this.contextLost = false; this.note.hidden = true; applyTheme(); this.resize(); this.updateLayerNote(); };
  private updateLayerNote() {
    if (this.contextLost) return;
    const error = this.world.stats?.().layerError;
    const message = typeof error === 'string' ? error : '';
    if (message === this.layerNote) return;
    this.layerNote = message;
    if (!message) { this.note.hidden = true; this.note.removeAttribute('style'); return; }
    this.note.style.cssText = 'inset:auto 10px 10px 54px;margin:0;padding:6px 10px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:11px;background:var(--panel);border:1px solid var(--edge);border-radius:6px';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.onclick = () => this.world.retryLayers?.();
    this.note.replaceChildren(document.createTextNode(message), retry); this.note.hidden = false;
  }
  private animate = (time: number) => {
    if (this.disposed) return; this.frameId = requestAnimationFrame(this.animate);
    try { this.tick(time); } catch (error) { const key = String(error instanceof Error ? error.stack : error); if (!this.reported.has(key)) { this.reported.add(key); console.error('深圳场景绘制失败', error); } }
  };
  private tick(time: number) {
    const dt = Math.max(0, Math.min(.1, (time - this.lastTime) / 1000)); this.lastTime = Math.max(this.lastTime, time);
    if (!this.paused) { this.accumulator += dt; while (this.accumulator >= 1 / 60) { this.simTime += 1 / 60; this.weather.update(1 / 60, this.simTime, this.hour()); this.accumulator -= 1 / 60; } }
    if (this.shift.h < this.shift.goal) this.shift.h = Math.min(this.shift.goal, this.shift.h + dt * (this.reduced ? 60 : 5));
    const hour = this.hour(); this.palette.update(this.theme(), hour, this.weather.rain(), this.weather.fog()); this.markNight(nightAmount(hour));
    this.rain.update(dt, this.controls.target, this.width / this.camera.zoom, this.weather.rain()); this.fog.update(this.simTime, this.weather.fog());
    this.dynamics.update(dt, this.paused, this.camera, this.weather.rain() > .3 ? '雨' : this.weather.fog() > .3 ? '雾' : '晴', this.camera.zoom);
    this.delivery?.update(dt, this.camera, this.reduced, nightAmount(hour), this.theme(), this.selected === this.delivery?.entity);
    const amount = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    if (this.following && this.selected) this.moveTarget(this.controls.target.clone().lerp(this.followTarget(), amount));
    if (this.goal) {
      if (this.goal.target) this.moveTarget(this.controls.target.clone().lerp(this.goal.target, amount));
      this.camera.zoom += (this.goal.zoom - this.camera.zoom) * amount; this.camera.updateProjectionMatrix();
      if (Math.abs(this.goal.zoom - this.camera.zoom) < 1e-3 * this.goal.zoom && (!this.goal.target || this.controls.target.distanceTo(this.goal.target) < .05)) this.goal = null;
    }
    this.controls.update(dt);
    const target = this.controls.target; this.moveTarget(target.clone().addScaledVector(ISO, -target.y / ISO.y));
    const home = W(clamp(target.x, this.world.bounds[0], this.world.bounds[1]), clamp(target.z, this.world.bounds[2], this.world.bounds[3]), 0);
    this.moveTarget(home.distanceTo(target) > 1 ? target.clone().lerp(home, amount) : home);
    this.camera.updateMatrixWorld();
    this.world.update?.(this.camera, this.camera.zoom, this.width, this.height, time / 1000);
    this.scene.updateMatrixWorld(); setTextFar(this.camera.zoom < 1.5);
    this.world.updateLabels?.(this.camera.zoom, this.camera, this.width, this.height);
    if (this.hoverDirty && this.pointer) { this.hoverDirty = false; this.hovered = this.hit(...this.pointer); this.canvas.classList.toggle('over', !!this.hovered); }
    this.placeTag(this.tagSel, this.selected, this.selected ? `${this.selected.title} · ${this.selected.info?.().status || '深圳地标'}` : '');
    this.placeTag(this.tagHover, this.hovered !== this.selected ? this.hovered : null, this.hovered?.title || '');
    this.updateReticle();
    if ((this.cardTime -= dt) <= 0) { this.cardTime = .25; this.refresh(); this.drawRoute(); this.updateLayerNote(); }
    const stop = this.routeNext?.name ? this.screenAt(this.routeNext.point) : null, anchor = stop && this.selected ? this.anchor(this.selected) : null;
    if (stop && anchor && stop[0] > 0 && stop[0] < this.width && stop[1] > 30 && stop[1] < this.height && Math.hypot(stop[0] - anchor[0], stop[1] - anchor[1]) > 70) this.placeAt(this.tagStop, stop, `下一站 · ${this.routeNext!.name}`);
    else this.tagStop.hidden = true;
    if (!this.contextLost) { const start = performance.now(); this.renderer.render(this.scene, this.camera); this.lastRenderMs = performance.now() - start; this.frameCount++; }
    if (time - this.fpsSince >= 1000) { this.fps = Math.round(this.frameCount * 1000 / (time - this.fpsSince)); this.frameCount = 0; this.fpsSince = time; }
  }
  stats() { const city = this.world.stats?.() ?? {}; return { roads: this.world.roads, buildings: this.world.buildings, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps, lastRenderMs: this.lastRenderMs, zoom: this.camera.zoom, fitZoom: this.fitZoom, target: this.controls.target.toArray(), goal: this.goal ? { zoom: this.goal.zoom, target: this.goal.target?.toArray() } : null, selected: this.selected?.id || null, following: this.following, paused: this.paused, hour: this.hour(), weather: { kind: this.weather.kind, amount: this.weather.amount }, animation: this.dynamics.counts, delivery: this.delivery?.stats() ?? null, mode: '深圳真实三维城市', geographicRequests: this.mapMetrics.requests, mapBytes: this.mapMetrics.bytes, mapUrl: '/data/shenzhen-city.json', loadedTiles: city.loadedTiles, terrainClipped: city.terrainClipped, city, mapLayers: { roads: this.world.roads, buildings: this.world.buildings, ...city } }; }
  debug() {
    return { stats: () => this.stats(), overview: () => this.overview(), view: (index: number) => this.goView(index), all: () => this.entities().map(entity => ({ id: entity.id, kind: entity.kind, title: entity.title, followable: entity.followable })), select: (id: string) => this.select(this.entities().find(entity => entity.id === id) || null), screenOf: (id: string) => {
      const entity = this.entities().find(candidate => candidate.id === id); if (!entity) return null;
      this.scene.updateMatrixWorld();
      const route = entity.routeId ? this.routes.find(candidate => candidate.id === entity.routeId) : null;
      const segment = route?.geometryStatus === '已核对路网' ? route.geometry.find(points => points.length > 1) : null;
      const coordinate = segment ? segment[Math.floor(segment.length / 2)] : route?.anchor;
      const projected = coordinate ? this.world.project(coordinate) : null;
      const point = projected ? W(...projected, this.surfaceHeight(projected) + .2) : this.bounds(entity).getCenter(new THREE.Vector3());
      const [x, y] = this.screenAt(point), rect = this.canvas.getBoundingClientRect(); return [rect.left + x, rect.top + y];
    }, sceneHeight: (coordinate: Coordinate) => this.surfaceHeight(this.world.project(coordinate)), routeHeight: (id: string) => {
      const route = this.routes.find(candidate => candidate.id === id); if (!route || route.geometryStatus !== '已核对路网') return null;
      const coordinates = route.geometry.flat(); if (!coordinates.length) return null;
      const heights = coordinates.map(coordinate => this.surfaceHeight(this.world.project(coordinate)));
      return { id, points: coordinates.length, minimum: Math.min(...heights), maximum: Math.max(...heights), lift: .24, samples: [0, Math.floor(coordinates.length / 2), coordinates.length - 1].filter(index => index >= 0 && index < coordinates.length).map(index => ({ coordinate: coordinates[index], ground: heights[index], route: heights[index] + .24 })) };
    }, retryLayers: () => this.world.retryLayers?.(), weather: (kind: 'rain' | 'fog') => this.weather.set(kind, 90, this.simTime), loseContext: () => this.renderer.forceContextLoss(), restoreContext: () => this.renderer.forceContextRestore() };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frameId); clearTimeout(this.turnTimer); this.observer?.disconnect();
    this.controls?.removeEventListener('change', this.changed); this.controls?.dispose();
    this.canvas.removeEventListener('wheel', this.wheel); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerleave', this.pointerLeave); this.canvas.removeEventListener('pointercancel', this.pointerCancel);
    this.canvas.removeEventListener('webglcontextlost', this.lost); this.canvas.removeEventListener('webglcontextrestored', this.restored);
    window.removeEventListener('keydown', this.guardEditable, true); window.removeEventListener('keydown', this.keyDown);
    this.systemTheme.removeEventListener('change', this.themeChanged); document.removeEventListener('visibilitychange', this.visibility);
    document.documentElement.classList.remove('after-dark', 'turning');
    if (this.delivery) { this.scene.remove(this.delivery.group); this.delivery.dispose(); this.delivery = null; }
    const geometries = new Set<THREE.BufferGeometry>(), textMaterials = new Set<THREE.MeshBasicMaterial>(this.registeredTextMaterials), owned = new Set<THREE.Object3D>(this.registeredTexts);
    this.scene.traverse(object => {
      owned.add(object); const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) if ((material as THREE.MeshBasicMaterial | undefined)?.map) textMaterials.add(material as THREE.MeshBasicMaterial);
    });
    this.registeredTexts.forEach(object => { const geometry = (object as THREE.Mesh).geometry; if (geometry) geometries.add(geometry); });
    geometries.forEach(geometry => geometry.dispose());
    textMaterials.forEach(material => { material.map?.dispose(); material.dispose(); });
    for (const materials of Object.values(TEXT) as THREE.MeshBasicMaterial[][]) for (let i = materials.length - 1; i >= 0; i--) if (textMaterials.has(materials[i])) materials.splice(i, 1);
    const texts = TEXT_MESHES as THREE.Object3D[]; for (let i = texts.length - 1; i >= 0; i--) if (owned.has(texts[i])) texts.splice(i, 1);
    this.world?.dispose?.(); this.palette?.dispose(); this.fog?.dispose(); this.renderer.dispose(); this.scene.clear();
    this.registeredTexts.clear(); this.registeredTextMaterials.clear();
  }
}
