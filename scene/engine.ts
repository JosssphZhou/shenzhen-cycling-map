import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { CyclingRoute } from '@/lib/types';
import { Palette } from './palette';
import { W } from './factory/kernel/iso';
import { Part, TEXT_MESHES } from './factory/kernel/part';
import { TEXT } from './factory/theme';
import { Path } from './factory/kernel/path';
import { buildRain } from './factory/world/weatherfx';
import { buildMiniature, diagramForRoute, ZONES, MINI_WORLD, BAY_VIEW, type MiniLabel } from './miniature';
import { CityDynamics } from './dynamics';

export interface SceneState { theme: 'light' | 'dark'; timeOfDay: number; weather: '晴' | '雨' | '雾'; paused: boolean }
interface Label { element: HTMLElement; point: THREE.Vector3; kind: MiniLabel['kind'] | 'route'; id?: string }
interface ViewGoal { zoom: number; target: THREE.Vector3 }
const ISO = new THREE.Vector3(1, 1, 1).normalize();
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const UP = new THREE.Vector3(-1, 2, -1).normalize();

/** 地标微缩图与GPX完全分离。这里不下载或读取城市地理数据。 */
export class CityEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 9000);
  readonly controls: OrbitControls;
  readonly palette = new Palette();
  private world = buildMiniature();
  private dynamics = new CityDynamics(this.world.movements);
  private rain = buildRain();
  private routeGroup = new THREE.Group();
  private labels: Label[] = [];
  private routes: CyclingRoute[] = [];
  private selected: CyclingRoute | null = null;
  private activeBounds = BAY_VIEW;
  private state: SceneState = { theme: 'light', timeOfDay: 10, weather: '晴', paused: false };
  private width = 1; private height = 1;
  private fitZoom = 1;
  private goal: ViewGoal | null = null;
  private frameId = 0; private disposed = false;
  private lastTime = 0; private lastRender = 0; private lastLabels = 0;
  private dirty = true; private frameCount = 0; private fps = 0; private fpsSince = 0; private lastRenderMs = 0;
  private labelLayer = document.createElement('div');
  private observer: ResizeObserver;
  private panelObserver: MutationObserver;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private visibility = () => { this.lastTime = performance.now(); this.dirty = true; };
  private manual = () => { this.goal = null; };
  private changed = () => { this.dirty = true; };
  private lost = (event: Event) => { event.preventDefault(); this.error('三维场景已暂停，请重新加载。'); };

  constructor(private host: HTMLElement, private onSelect: (id: string) => void, private error: (message: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.renderer.domElement.setAttribute('aria-label', '深圳地标微缩场景，非等比例，拖动平移，滚轮或双指缩放');
    this.renderer.domElement.tabIndex = 0;
    this.host.appendChild(this.renderer.domElement);
    this.labelLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    this.host.appendChild(this.labelLayer);
    this.camera.position.copy(ISO).multiplyScalar(5000); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableRotate: false, screenSpacePanning: true, zoomToCursor: true, enableDamping: !this.reduced, dampingFactor: .12 });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('start', this.manual); this.controls.addEventListener('change', this.changed);
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.lost);
    this.scene.add(this.world.group, this.dynamics.group, this.routeGroup, this.rain.group);
    for (const label of this.world.labels) {
      const element = document.createElement('button');
      element.textContent = label.name;
      element.setAttribute('aria-label', `靠近查看${label.name}`);
      element.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font:inherit;font-size:10px;letter-spacing:.1em;transform:translate(-2000px,-2000px);border:0;background:transparent;padding:5px;pointer-events:auto;cursor:pointer';
      if (label.kind === 'water') element.style.letterSpacing = '.35em';
      element.onclick = () => {
        const [x, y] = label.point;
        this.activeBounds = [x - 115, x + 115, y - 105, y + 100];
        this.goal = this.frame(this.activeBounds, 110);
      };
      this.labelLayer.appendChild(element);
      this.labels.push({ element, point: W(...label.point), kind: label.kind });
    }
    this.observer = new ResizeObserver(this.resize); this.observer.observe(this.host);
    this.panelObserver = new MutationObserver(() => { this.goal = this.frame(this.activeBounds, 110); });
    const stage = this.host.closest('.stage'); if (stage) this.panelObserver.observe(stage, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', this.visibility);
    this.resize(); this.frameId = requestAnimationFrame(this.animate);
  }
  private frame(bounds: [number, number, number, number], height = 110): ViewGoal {
    this.camera.updateMatrixWorld();
    const visibleBounds = this.width <= 700 && bounds === BAY_VIEW ? [145, 335, 120, 285] : bounds;
    const [x0, x1, y0, y1] = visibleBounds, box = new THREE.Box3();
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [0, height]) box.expandByPoint(W(x, y, z).applyMatrix4(this.camera.matrixWorldInverse));
    const stage = this.host.closest('.stage');
    const panel = stage?.classList.contains('with-panel') ? stage.querySelector<HTMLElement>('.route-panel')?.getBoundingClientRect() : null;
    const left = this.width > 700 ? (panel?.width || 0) + 32 : 18;
    const right = this.width > 700 ? 50 : 42;
    const top = this.width > 700 ? 62 : 63;
    const bottom = this.width > 700 ? 45 : (panel?.height || 0) + 40;
    const zoom = Math.min(Math.max(120, this.width - left - right) / (box.max.x - box.min.x), Math.max(120, this.height - top - bottom) / (box.max.y - box.min.y)) * .94;
    const target = W((x0 + x1) / 2, (y0 + y1) / 2, bounds === BAY_VIEW ? 0 : height / 2);
    target.addScaledVector(RIGHT, -(left - right) / (2 * zoom));
    target.addScaledVector(UP, -(bottom - top) / (2 * zoom));
    return { zoom, target };
  }
  private resize = () => {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    const first = this.width === 1; this.width = width; this.height = height;
    this.renderer.setSize(width, height, false); this.palette.resize(width, height);
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    this.camera.updateProjectionMatrix();
    this.fitZoom = this.frame(MINI_WORLD).zoom;
    this.controls.minZoom = this.fitZoom * .7; this.controls.maxZoom = 12;
    const frame = this.frame(this.activeBounds);
    if (first) { this.camera.zoom = frame.zoom; this.moveTarget(frame.target); this.camera.updateProjectionMatrix(); }
    else this.goal = frame;
    this.dirty = true;
  };
  private moveTarget(target: THREE.Vector3) { const delta = target.clone().sub(this.controls.target); this.controls.target.add(delta); this.camera.position.add(delta); }
  overview() { this.activeBounds = MINI_WORLD; this.goal = this.frame(MINI_WORLD); }
  zoomBy(factor: number) { this.goal = { zoom: THREE.MathUtils.clamp((this.goal?.zoom || this.camera.zoom) * factor, this.controls.minZoom, this.controls.maxZoom), target: this.goal?.target.clone() || this.controls.target.clone() }; }
  setState(state: SceneState) { this.state = state; this.dirty = true; }
  setRoutes(routes: CyclingRoute[]) {
    this.routes = routes;
    this.labels.filter(label => label.kind === 'route').forEach(label => label.element.remove());
    this.labels = this.labels.filter(label => label.kind !== 'route');
    routes.forEach((route, index) => {
      const diagram = diagramForRoute(route);
      const element = document.createElement('button'); element.textContent = String(index + 1).padStart(2, '0');
      element.setAttribute('aria-label', `查看${route.name}`); element.title = route.name;
      element.style.cssText = 'position:absolute;left:0;top:0;width:25px;height:25px;border:1px solid currentColor;border-radius:50%;font:inherit;font-size:9px;padding:0;pointer-events:auto;cursor:pointer;transform:translate(-2000px,-2000px)';
      element.onclick = () => this.onSelect(route.id); this.labelLayer.appendChild(element);
      this.labels.push({ element, point: W(...diagram.anchor, 3), kind: 'route', id: route.id });
    });
    this.rebuildRoutes(); this.dirty = true;
  }
  select(route: CyclingRoute | null) {
    if (this.selected?.id === route?.id) return;
    this.selected = route; this.dirty = true;
    this.activeBounds = route ? diagramForRoute(route).zone.bounds : BAY_VIEW;
    this.goal = this.frame(this.activeBounds);
    this.rebuildRoutes();
  }
  private rebuildRoutes() {
    this.routeGroup.traverse(object => (object as THREE.Mesh).geometry?.dispose()); this.routeGroup.clear();
    if (!this.selected) return;
    const diagram = diagramForRoute(this.selected);
    if (!diagram.points.length) return;
    const path = new Path(diagram.points, 10, false), positions: number[] = [];
    for (let s = 0; s < path.length; s += 2) { const a = path.at(s)!, b = path.at(Math.min(path.length, s + 2))!; positions.push(...W(a.x, a.y, .7).toArray(), ...W(b.x, b.y, .7).toArray()); }
    const material = this.palette.line('live', 2.3); material.depthTest = false; material.depthWrite = false;
    const line = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material); line.renderOrder = 10;
    this.routeGroup.add(line);
    const flags = new Part();
    for (const [x, y] of [diagram.points[0], diagram.points.at(-1)!]) { flags.box(x - .12, y - .12, .1, .24, .24, 6); flags.box(x, y, 3.7, 4, .12, 2.2, 'k'); }
    this.routeGroup.add(flags.build('路线示意起终点'));
  }
  private updateLabels() {
    const used: { x: number; y: number; width: number }[] = [];
    const labels = [...this.labels].sort((a, b) => Number(b.kind === 'landmark') - Number(a.kind === 'landmark'));
    for (const label of labels) {
      const screen = label.point.clone().project(this.camera);
      const x = (screen.x + 1) * this.width / 2, y = (1 - screen.y) * this.height / 2;
      const active = label.kind === 'route' && label.id === this.selected?.id;
      let visible = x > 10 && x < this.width - 20 && y > 60 && y < this.height - 32;
      if (label.kind === 'route') visible &&= active;
      if (label.kind === 'district') visible &&= this.camera.zoom < .7;
      if (label.kind === 'water') visible &&= this.camera.zoom > .55;
      if (!active && used.some(p => Math.abs(x - p.x) < Math.max(28, p.width) && Math.abs(y - p.y) < 24)) visible = false;
      if (visible) used.push({ x, y, width: label.kind === 'landmark' ? 45 : 30 });
      label.element.style.display = visible ? '' : 'none';
      label.element.style.color = `#${this.palette.colors[label.kind === 'landmark' || active ? 'live' : 'ink'].getHexString()}`;
      if (label.kind === 'route') { label.element.style.background = `#${this.palette.colors.background.getHexString()}`; label.element.style.zIndex = '4'; }
      if (visible) label.element.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
    }
  }
  private animate = (time: number) => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    if (document.hidden) return;
    if (time - this.fpsSince > 1000) { this.fps = Math.round(this.frameCount * 1000 / (time - this.fpsSince)); this.frameCount = 0; this.fpsSince = time; }
    if (time - this.lastRender < 1000 / 30 && !this.state.paused) return;
    const dt = Math.min((time - (this.lastTime || time)) / 1000, .1); this.lastTime = time;
    if (this.goal) {
      const amount = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
      this.moveTarget(this.controls.target.clone().lerp(this.goal.target, amount));
      this.camera.zoom += (this.goal.zoom - this.camera.zoom) * amount; this.camera.updateProjectionMatrix();
      if (Math.abs(this.camera.zoom - this.goal.zoom) < .001 * this.camera.zoom && this.controls.target.distanceTo(this.goal.target) < .05) this.goal = null;
      this.dirty = true;
    }
    this.controls.update();
    this.palette.update(this.state.theme, this.state.timeOfDay, this.state.weather);
    this.scene.background = this.palette.colors.background;
    if (this.state.weather === '雾') { if (!this.scene.fog) this.scene.fog = new THREE.Fog(this.palette.colors.fog, 4450, 6500); else this.scene.fog.color.copy(this.palette.colors.fog); } else this.scene.fog = null;
    this.dynamics.update(dt, this.state.paused || this.reduced, this.camera, this.state.weather, this.camera.zoom);
    this.rain.update(this.state.paused || this.reduced ? 0 : dt, this.controls.target, this.width / this.camera.zoom, this.state.weather === '雨' ? .65 : 0);
    if (time - this.lastLabels > 80 || this.dirty) { this.updateLabels(); this.lastLabels = time; }
    if (this.dirty || (!this.state.paused && !this.reduced)) {
      const start = performance.now(); this.renderer.render(this.scene, this.camera); this.lastRenderMs = performance.now() - start;
      this.frameCount++; this.lastRender = time; this.dirty = false;
    }
  };
  stats() { return { roads: this.world.roads, buildings: this.world.buildings, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps, lastRenderMs: this.lastRenderMs, zoom: this.camera.zoom, animation: this.dynamics.counts, mode: '地标微缩示意', geographicRequests: 0 }; }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frameId); this.observer.disconnect(); this.panelObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibility);
    this.controls.removeEventListener('start', this.manual); this.controls.removeEventListener('change', this.changed); this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.lost);
    const geometries = new Set<THREE.BufferGeometry>();
    const textMaterials = new Set<THREE.MeshBasicMaterial>();
    const owned = new Set<THREE.Object3D>();
    this.scene.traverse(object => {
      owned.add(object);
      const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) if ((material as THREE.MeshBasicMaterial | undefined)?.map) textMaterials.add(material as THREE.MeshBasicMaterial);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of textMaterials) { material.map?.dispose(); material.dispose(); }
    for (const materials of Object.values(TEXT) as THREE.MeshBasicMaterial[][]) {
      for (let i = materials.length - 1; i >= 0; i--) if (textMaterials.has(materials[i])) materials.splice(i, 1);
    }
    const texts = TEXT_MESHES as THREE.Object3D[];
    for (let i = texts.length - 1; i >= 0; i--) if (owned.has(texts[i])) texts.splice(i, 1);
    this.palette.dispose(); this.renderer.dispose(); this.scene.clear();
    this.renderer.domElement.remove(); this.labelLayer.remove();
  }
}
