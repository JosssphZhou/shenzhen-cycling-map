import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { CyclingRoute } from '@/lib/types';
import type { SceneController, SceneSelection, SceneSnapshot } from './contract';
import { Palette, nightAmount } from './palette';
import { W } from './factory/kernel/iso';
import { TEXT_MESHES, setTextFar } from './factory/kernel/part';
import { TEXT, LINE, applyTheme } from './factory/theme';
import { Path } from './factory/kernel/path';
import { buildRain } from './factory/world/weatherfx';
import { buildMiniature, diagramForRoute, ZONES, MINI_WORLD, BAY_VIEW, type MiniEntity } from './miniature';
import { CityDynamics } from './dynamics';
import { CityWeather, buildCityFog } from './interaction-weather';

interface ViewGoal { zoom: number; target?: THREE.Vector3 }
type Bounds = [number, number, number, number, ...number[]];
const ISO = new THREE.Vector3(1, 1, 1).normalize();
const lines = LINE as Record<string, LineMaterial>;
const clamp = THREE.MathUtils.clamp;
const VIEWS: Bounds[] = [BAY_VIEW, ...ZONES.slice(1).map(zone => zone.bounds), [265, 425, -65, 95], [815, 1100, -115, 165], [705, 910, -70, 165], [960, 1145, -60, 120, 0, 80]];
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"]');

/** Factory yard/view.ts 的镜头、拾取、浮签和时间交互，内容由深圳实体提供。 */
export class CityEngine implements SceneController {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 9000);
  readonly controls!: OrbitControls;
  readonly palette!: Palette;
  private world!: ReturnType<typeof buildMiniature>;
  private dynamics!: CityDynamics;
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

  constructor(private canvas: HTMLCanvasElement, private stage: HTMLElement, private onSnapshot: (snapshot: SceneSnapshot) => void) {
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
      const center = W((MINI_WORLD[0] + MINI_WORLD[1]) / 2, (MINI_WORLD[2] + MINI_WORLD[3]) / 2, 0);
      this.camera.position.copy(center).addScaledVector(ISO, 5000); this.camera.lookAt(center);
      this.controls = new OrbitControls(this.camera, canvas);
      Object.assign(this.controls, { enableRotate: false, screenSpacePanning: true, zoomToCursor: true, enableDamping: !this.reduced, dampingFactor: .12 });
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      this.controls.target.copy(center); this.controls.listenToKeyEvents(window);
      this.world = buildMiniature(); this.scene.add(this.world.group);
      this.dynamics = new CityDynamics(this.world.movements); this.scene.add(this.dynamics.group);
      this.rain = buildRain(); this.scene.add(this.rain.group);
      this.fog = buildCityFog(); this.scene.add(this.fog.group);
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
  private resize = () => {
    const width = this.stage.clientWidth, height = this.stage.clientHeight; if (!width || !height) return;
    this.width = width; this.height = height; this.renderer.setSize(width, height, false);
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    const frame = this.frame(MINI_WORLD, [-4, 50]); this.fitZoom = frame.zoom; this.home.copy(frame.target!);
    this.baseZoom = this.frame([MINI_WORLD[0], 1000, MINI_WORLD[2], MINI_WORLD[3]], [-4, 50]).zoom;
    this.controls.minZoom = this.fitZoom * .6; this.controls.maxZoom = this.baseZoom * 36;
    if (!this.sized) { this.sized = true; const first = width < 600 ? this.frame(VIEWS[0]) : frame; this.camera.zoom = first.zoom; this.moveTarget(first.target!); }
    this.camera.zoom = clamp(this.camera.zoom, this.controls.minZoom, this.controls.maxZoom); this.camera.updateProjectionMatrix();
    this.palette.resize(width, height); this.hoverDirty = true;
  };
  private moveTarget(target: THREE.Vector3) { const delta = target.clone().sub(this.controls.target); this.controls.target.add(delta); this.camera.position.add(delta); }
  overview() { this.setFollow(false); this.goal = { zoom: this.fitZoom, target: this.home.clone() }; }
  goView(index: number) { if (!VIEWS[index]) return; this.setFollow(false); this.goal = this.frame(VIEWS[index]); }
  zoomBy(factor: number) { this.goal = { zoom: clamp((this.goal?.zoom ?? this.camera.zoom) * factor, this.controls.minZoom, this.controls.maxZoom), target: this.goal?.target }; }
  setRoutes(routes: CyclingRoute[]) { this.routes = routes; }
  private entities() { return [...this.world.entities, ...this.dynamics.entities]; }
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
    if (entity && entity === this.selected) return;
    this.selectionRevision++;
    this.setLive(this.selected, false); this.selected = entity; this.routeSelection = route;
    this.setLive(entity, true); this.following = false; this.refresh(); this.drawRoute();
  }
  clearSelection() { this.select(null); this.canvas.focus(); }
  selectRoute(route: CyclingRoute | null) {
    if (!route) { this.clearSelection(); return; }
    if (route.id === this.routeSelection?.id) return;
    const diagram = diagramForRoute(route), path = diagram.points.length > 1 ? new Path(diagram.points, .01, false) : null;
    const entity: MiniEntity = {
      id: route.id, kind: '骑行路线', title: route.name, groups: [], relatedRouteIds: [], followable: false,
      bbox: () => new THREE.Box3(W(diagram.anchor[0] - 2, diagram.anchor[1] - 2, 0), W(diagram.anchor[0] + 2, diagram.anchor[1] + 2, 2)),
      info: () => ({ title: route.name, status: route.status, rows: [['里程', route.distanceKm === null ? '待核对' : `${route.distanceKm.toFixed(2)} 公里`], ['爬升', route.ascentM === null ? '待核对' : `${route.ascentM} 米`], ['路面', route.surface], ['公路车', route.roadBike]] }),
      ...(path ? { route: () => ({ path, s: 0, closed: false, next: { x: diagram.points.at(-1)![0], y: diagram.points.at(-1)![1], name: route.end } }) } : {}),
    };
    this.select(entity, route);
  }
  focusSelection() {
    if (!this.selected) return;
    this.setFollow(false);
    if (this.routeSelection) this.goal = this.frame(diagramForRoute(this.routeSelection).zone.bounds);
    else {
      const box = this.bounds(this.selected), margin = Math.max(10, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * .3);
      this.goal = this.frame([box.min.x - margin, box.max.x + margin, box.min.z - margin, box.max.z + margin], [Math.min(0, box.min.y), box.max.y]);
    }
  }
  private hit(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    for (const hit of this.ray.intersectObjects(this.scene.children, true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      let visible = true; for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (!node.visible) visible = false;
      if (!visible || hit.point.x < MINI_WORLD[0] || hit.point.x > MINI_WORLD[1] || hit.point.z < MINI_WORLD[2] || hit.point.z > MINI_WORLD[3]) continue;
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
    VIEWS.forEach(([x0, x1, y0, y1, z0 = 0, z1 = 12], k) => {
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
    const box = this.bounds(this.selected), x0 = box.min.x - .8, z0 = box.min.z - .8, y = Math.max(0, box.min.y) + .06;
    const width = box.max.x + .8 - x0, depth = box.max.z + .8 - z0, key = `${width.toFixed(1)}|${depth.toFixed(1)}`;
    if (key !== this.reticleKey) {
      this.reticleKey = key; const length = Math.min(3, width / 3, depth / 3), positions: number[] = [];
      for (const [x, dx] of [[0, 1], [width, -1]]) for (const [z, dz] of [[0, 1], [depth, -1]]) positions.push(x, 0, z, x + dx * length, 0, z, x, 0, z, x, 0, z + dz * length);
      this.reticle.geometry.dispose(); this.reticle.geometry = new LineSegmentsGeometry().setPositions(positions);
    }
    this.reticle.position.set(x0, y, z0); this.reticle.visible = true;
  }
  private drawRoute() {
    const route = this.selected?.route?.(), path = route?.path;
    if (!route || !path?.length) { this.routeLine.visible = false; this.routeNext = null; return; }
    const z = .24, positions: number[] = [], start = route.reverse ? 0 : route.s ?? 0, end = route.reverse ? route.s : route.closed ? start + path.length : path.length;
    for (let distance = start; distance < end; distance += 1.6) { const a = path.at(distance)!, b = path.at(Math.min(distance + .8, end))!; positions.push(a.x, z, a.y, b.x, z, b.y); }
    this.routeNext = route.next ? { point: W(route.next.x, route.next.y, z), name: route.next.name || '' } : null;
    if (route.next) {
      const radius = this.selected?.kind === '行人' ? 1.1 : 3.2;
      for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2, b = (i + 1) / 32 * Math.PI * 2; positions.push(route.next.x + Math.cos(a) * radius, z, route.next.y + Math.sin(a) * radius, route.next.x + Math.cos(b) * radius, z, route.next.y + Math.sin(b) * radius); }
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
  private lost = (event: Event) => { event.preventDefault(); this.contextLost = true; this.note.hidden = false; this.note.textContent = '正在重新绘制场景…'; };
  private restored = () => { this.contextLost = false; this.note.hidden = true; applyTheme(); this.resize(); };
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
    const amount = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    if (this.following && this.selected) { const center = this.bounds(this.selected).getCenter(new THREE.Vector3()); this.moveTarget(this.controls.target.clone().lerp(center.addScaledVector(ISO, -center.y / ISO.y), amount)); }
    if (this.goal) {
      if (this.goal.target) this.moveTarget(this.controls.target.clone().lerp(this.goal.target, amount));
      this.camera.zoom += (this.goal.zoom - this.camera.zoom) * amount; this.camera.updateProjectionMatrix();
      if (Math.abs(this.goal.zoom - this.camera.zoom) < 1e-3 * this.goal.zoom && (!this.goal.target || this.controls.target.distanceTo(this.goal.target) < .05)) this.goal = null;
    }
    this.controls.update(dt);
    const target = this.controls.target; this.moveTarget(target.clone().addScaledVector(ISO, -target.y / ISO.y));
    const home = W(clamp(target.x, MINI_WORLD[0], MINI_WORLD[1]), clamp(target.z, MINI_WORLD[2], MINI_WORLD[3]), 0);
    this.moveTarget(home.distanceTo(target) > 1 ? target.clone().lerp(home, amount) : home);
    this.camera.updateMatrixWorld(); this.scene.updateMatrixWorld(); setTextFar(this.camera.zoom < 1.5);
    if (this.hoverDirty && this.pointer) { this.hoverDirty = false; this.hovered = this.hit(...this.pointer); this.canvas.classList.toggle('over', !!this.hovered); }
    this.placeTag(this.tagSel, this.selected, this.selected ? `${this.selected.title} · ${this.selected.info?.().status || '深圳地标'}` : '');
    this.placeTag(this.tagHover, this.hovered !== this.selected ? this.hovered : null, this.hovered?.title || '');
    this.updateReticle();
    if ((this.cardTime -= dt) <= 0) { this.cardTime = .25; this.refresh(); this.drawRoute(); }
    const stop = this.routeNext?.name ? this.screenAt(this.routeNext.point) : null, anchor = stop && this.selected ? this.anchor(this.selected) : null;
    if (stop && anchor && stop[0] > 0 && stop[0] < this.width && stop[1] > 30 && stop[1] < this.height && Math.hypot(stop[0] - anchor[0], stop[1] - anchor[1]) > 70) this.placeAt(this.tagStop, stop, `下一站 · ${this.routeNext!.name}`);
    else this.tagStop.hidden = true;
    if (!this.contextLost) { const start = performance.now(); this.renderer.render(this.scene, this.camera); this.lastRenderMs = performance.now() - start; this.frameCount++; }
    if (time - this.fpsSince >= 1000) { this.fps = Math.round(this.frameCount * 1000 / (time - this.fpsSince)); this.frameCount = 0; this.fpsSince = time; }
  }
  stats() { return { roads: this.world.roads, buildings: this.world.buildings, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps, lastRenderMs: this.lastRenderMs, zoom: this.camera.zoom, fitZoom: this.fitZoom, target: this.controls.target.toArray(), goal: this.goal ? { zoom: this.goal.zoom, target: this.goal.target?.toArray() } : null, selected: this.selected?.id || null, following: this.following, paused: this.paused, hour: this.hour(), weather: { kind: this.weather.kind, amount: this.weather.amount }, animation: this.dynamics.counts, mode: '地标微缩示意', geographicRequests: 0 }; }
  debug() {
    return { stats: () => this.stats(), overview: () => this.overview(), view: (index: number) => this.goView(index), all: () => this.entities().map(entity => ({ id: entity.id, kind: entity.kind, title: entity.title, followable: entity.followable })), select: (id: string) => this.select(this.entities().find(entity => entity.id === id) || null), screenOf: (id: string) => {
      const entity = this.entities().find(candidate => candidate.id === id); if (!entity) return null;
      this.scene.updateMatrixWorld(); const point = this.bounds(entity).getCenter(new THREE.Vector3()), [x, y] = this.screenAt(point), rect = this.canvas.getBoundingClientRect(); return [rect.left + x, rect.top + y];
    }, weather: (kind: 'rain' | 'fog') => this.weather.set(kind, 90, this.simTime), loseContext: () => this.renderer.forceContextLoss(), restoreContext: () => this.renderer.forceContextRestore() };
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
    this.palette?.dispose(); this.fog?.dispose(); this.renderer.dispose(); this.scene.clear();
    this.registeredTexts.clear(); this.registeredTextMaterials.clear();
  }
}
