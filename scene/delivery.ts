import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { DeliverySceneState } from '@/lib/delivery/scene-contract';
import type { Coordinate } from '@/lib/types';
import { Part, pose } from './factory/kernel/part';
import { W } from './factory/kernel/iso';
import { buildCyclist } from './landmarks';
import { ExactPath, terrainSegment, type Bounds, type MiniEntity, type Point } from './entities';

interface DeliveryWorld {
  project(coordinate: Coordinate): Point;
  surfaceHeight?(point: Point): number;
  terrainStep?: number;
  zoneAt(point: Point): { name: string };
}
interface MapLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  width: number;
}
interface StopMarker {
  group: THREE.Group;
  circle: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: MapLabel;
  point: Point;
  done: boolean;
  entity: MiniEntity;
}
const WARM_DAY = new THREE.Color('#b47a42');
const WARM_NIGHT = new THREE.Color('#edbd83');
const coordinateKey = (coordinates: Coordinate[]) => coordinates.map(point => point.join(',')).join(';');

/** 时间、订单和钱包由领域模块持有；本层只沿完整路线绘制当前状态。 */
export class DeliveryLayer {
  readonly group = new THREE.Group();
  readonly rider = buildCyclist();
  readonly entity: MiniEntity;
  private state: DeliverySceneState;
  private path = new ExactPath([]);
  private targetDistance = 0;
  private renderedDistance = 0;
  private distanceFrom = 0;
  private interpolation = 1;
  private heading = 0;
  private pathKey = '';
  private completedKey = '';
  private stopKey = '';
  private pathPoints: Point[] = [];
  private stops: StopMarker[] = [];
  private labelTheme = '';
  private riderScale = 1.8;
  private position: Point;
  private readonly riderLabel = this.label('外卖骑手');
  private readonly warm = new THREE.MeshBasicMaterial({ color: WARM_DAY, side: THREE.DoubleSide });
  private readonly lid = new THREE.MeshBasicMaterial({ color: WARM_NIGHT, side: THREE.DoubleSide });
  private readonly stopMaterial = new THREE.MeshBasicMaterial({ color: WARM_DAY, transparent: true, opacity: .95, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  private readonly doneMaterial = new THREE.MeshBasicMaterial({ color: '#89908f', transparent: true, opacity: .7, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  private readonly routeMaterial = new LineMaterial({ color: WARM_DAY, linewidth: 2.3, transparent: true, opacity: .9, depthTest: false, depthWrite: false });
  private readonly completedMaterial = new LineMaterial({ color: '#90948e', linewidth: 1.6, transparent: true, opacity: .55, depthTest: false, depthWrite: false });
  private readonly route = new LineSegments2(new LineSegmentsGeometry(), this.routeMaterial);
  private readonly completed = new LineSegments2(new LineSegmentsGeometry(), this.completedMaterial);

  constructor(private world: DeliveryWorld, state: DeliverySceneState) {
    this.state = state;
    this.position = world.project(state.position);
    this.group.name = '外卖专注配送';
    this.rider.name = '外卖骑手';
    const box = new Part();
    box.box(-1.02, -.3, .72, .63, .6, .57, 'n');
    box.box(-1.04, -.32, 1.29, .67, .64, .075, 'k');
    const cargo = box.build('配送餐箱');
    for (const object of cargo.children) {
      if (object instanceof THREE.Mesh && object.userData.fill) object.material = object.userData.fill === 'kob' || object.userData.fill === 'kod' ? this.lid : this.warm;
    }
    this.rider.add(cargo);
    this.route.raycast = () => {};
    this.completed.raycast = () => {};
    this.route.frustumCulled = false;
    this.completed.frustumCulled = false;
    this.route.renderOrder = 8;
    this.completed.renderOrder = 9;
    this.group.add(this.route, this.completed, this.rider, this.riderLabel.sprite);
    this.entity = {
      id: 'delivery-rider', title: '外卖骑手', kind: '配送骑手', groups: [this.rider], relatedRouteIds: [], followable: true,
      info: () => ({ status: this.state.status, rows: [['片区', this.world.zoneAt(this.position).name], ['状态', this.state.active ? '正在配送' : '等待开工'], ['说明', '专注配送模拟']] }),
      bbox: () => {
        const [x, z] = this.position, height = this.height(this.position), margin = this.riderScale * 1.1;
        return new THREE.Box3(W(x - margin, z - margin, height + .12), W(x + margin, z + margin, height + this.riderScale * 1.65));
      },
    };
    this.rider.userData.entity = this.entity;
    this.setState(state);
    this.placeRider();
  }

  get entities(): MiniEntity[] { return [this.entity, ...this.stops.map(stop => stop.entity)]; }
  private height(point: Point) { return this.world.surfaceHeight?.(point) ?? 0; }

  setState(state: DeliverySceneState) {
    this.state = state;
    const pathKey = coordinateKey(state.path), pathChanged = this.pathKey !== pathKey;
    if (pathChanged) {
      this.pathKey = pathKey;
      this.pathPoints = state.path.map(coordinate => this.world.project(coordinate));
      this.path = new ExactPath(this.pathPoints);
      this.replaceLine(this.route, this.pathPoints);
    }
    const completedPoints = state.completedPath.map(coordinate => this.world.project(coordinate));
    const targetDistance = new ExactPath(completedPoints).length;
    if (pathChanged || targetDistance < this.renderedDistance || !this.path.length) {
      this.renderedDistance = targetDistance;
      this.position = this.world.project(state.position);
      this.interpolation = 1;
    } else {
      this.distanceFrom = this.renderedDistance;
      this.interpolation = 0;
    }
    this.targetDistance = targetDistance;
    const completedKey = coordinateKey(state.completedPath);
    if (this.completedKey !== completedKey) { this.completedKey = completedKey; this.replaceLine(this.completed, completedPoints); }
    const stopKey = state.stops.map(stop => `${stop.coordinate.join(',')}:${stop.kind}:${stop.label}`).join(';');
    if (this.stopKey !== stopKey) {
      this.stopKey = stopKey;
      this.clearStops();
      state.stops.forEach((stop, index) => this.addStop(stop, index));
    }
    this.stops.forEach((stop, index) => {
      stop.done = state.stops[index]?.done ?? false;
      stop.circle.material = stop.done ? this.doneMaterial : this.stopMaterial;
      stop.label.sprite.material.opacity = stop.done ? .55 : 1;
    });
  }

  resize(width: number, height: number) {
    this.routeMaterial.resolution.set(width, height);
    this.completedMaterial.resolution.set(width, height);
  }

  update(dt: number, camera: THREE.OrthographicCamera, reduced: boolean, night: number, theme: 'light' | 'dark') {
    this.interpolation = reduced ? 1 : Math.min(1, this.interpolation + dt / .24);
    this.renderedDistance = this.distanceFrom + (this.targetDistance - this.distanceFrom) * this.interpolation;
    const point = this.path.at(this.renderedDistance);
    if (point) { this.position = [point.x, point.y]; this.heading = point.h; }
    else this.position = this.world.project(this.state.position);
    this.riderScale = THREE.MathUtils.clamp(18 / Math.max(.1, camera.zoom) / 1.5, 1.8, 7);
    this.placeRider();
    this.riderLabel.sprite.position.copy(W(...this.position, this.height(this.position) + this.riderScale * 2.1));
    this.sizeLabel(this.riderLabel, camera.zoom, 14);
    this.stops.forEach(stop => {
      const scale = THREE.MathUtils.clamp(6 / Math.max(.1, camera.zoom), .6, 8);
      stop.circle.scale.setScalar(scale);
      stop.group.position.copy(W(...stop.point, this.height(stop.point) + .32));
      stop.label.sprite.position.copy(W(...stop.point, this.height(stop.point) + 8 / Math.max(.1, camera.zoom)));
      this.sizeLabel(stop.label, camera.zoom, 12);
      stop.label.sprite.visible = camera.zoom > 1.25;
    });
    this.warm.color.copy(WARM_DAY).lerp(WARM_NIGHT, night);
    this.routeMaterial.color.copy(this.warm.color);
    this.stopMaterial.color.copy(this.warm.color);
    const labelTheme = `${theme}:${night > .5 ? 'night' : 'day'}`;
    if (labelTheme !== this.labelTheme) {
      this.labelTheme = labelTheme;
      this.paintLabel(this.riderLabel, '外卖骑手');
      this.stops.forEach((stop, index) => this.paintLabel(stop.label, `${this.state.stops[index]?.kind === 'pickup' ? '取' : '送'} ${this.state.stops[index]?.label ?? ''}`));
    }
  }

  private placeRider() {
    this.rider.scale.setScalar(this.riderScale);
    pose(this.rider, this.position[0], this.position[1], this.heading, this.height(this.position) + .16);
    const front = this.path.at(this.renderedDistance + .4), back = this.path.at(this.renderedDistance - .4);
    if (front && back) {
      const distance = Math.hypot(front.x - back.x, front.y - back.y);
      this.rider.rotation.z = distance > 1e-6 ? Math.atan2(this.height([front.x, front.y]) - this.height([back.x, back.y]), distance) : 0;
    }
  }

  private replaceLine(line: LineSegments2, points: Point[]) {
    const positions: number[] = [];
    for (let index = 1; index < points.length; index++) positions.push(...terrainSegment(points[index - 1], points[index], point => this.height(point), Math.min(.4, (this.world.terrainStep ?? 1.6) / 4), .3));
    line.geometry.dispose();
    line.geometry = new LineSegmentsGeometry();
    if (positions.length) line.geometry.setPositions(positions);
    line.visible = positions.length > 0;
  }

  private addStop(stop: DeliverySceneState['stops'][number], index: number) {
    const point = this.world.project(stop.coordinate), group = new THREE.Group();
    const circle = new THREE.Mesh(new THREE.RingGeometry(.52, .75, stop.kind === 'pickup' ? 4 : 24), this.stopMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.renderOrder = 10;
    group.add(circle);
    const label = this.label(`${stop.kind === 'pickup' ? '取' : '送'} ${stop.label}`);
    const entity: MiniEntity = {
      id: `delivery-stop-${index}`, title: stop.label, kind: stop.kind === 'pickup' ? '取餐点' : '送达点', groups: [group], followable: false, relatedRouteIds: [],
      info: () => ({ status: this.stops[index]?.done ? '已完成' : '本趟配送地点', rows: [['片区', this.world.zoneAt(point).name], ['说明', '虚构订单的地图位置']] }),
      bbox: () => { const height = this.height(point); return new THREE.Box3(W(point[0] - 1, point[1] - 1, height), W(point[0] + 1, point[1] + 1, height + 1)); },
    };
    group.userData.entity = entity;
    this.stops.push({ point, group, circle, label, done: stop.done, entity });
    this.group.add(group, label.sprite);
  }

  private label(text: string): MapLabel {
    const canvas = document.createElement('canvas');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: true });
    const sprite = new THREE.Sprite(material);
    sprite.raycast = () => {};
    sprite.renderOrder = 12;
    const label = { canvas, texture, material, sprite, width: 1 };
    this.paintLabel(label, text);
    return label;
  }

  private paintLabel(label: MapLabel, text: string) {
    const style = getComputedStyle(document.documentElement), font = `500 40px ${style.getPropertyValue('--mono').trim()}`;
    const measure = label.canvas.getContext('2d');
    if (!measure) return;
    measure.font = font;
    label.canvas.width = Math.ceil(measure.measureText(text).width) + 28;
    label.canvas.height = 62;
    const context = label.canvas.getContext('2d');
    if (!context) return;
    context.font = font;
    context.fillStyle = style.getPropertyValue('--page-panel').trim() || '#ededeb';
    context.beginPath(); context.roundRect(1, 1, label.canvas.width - 2, 60, 8); context.fill();
    context.strokeStyle = style.getPropertyValue('--page-edge').trim() || '#9b9d9b'; context.lineWidth = 2; context.stroke();
    context.fillStyle = style.getPropertyValue('--page-ink-hi').trim() || '#292b2b';
    context.textBaseline = 'middle'; context.fillText(text, 14, 32);
    label.width = label.canvas.width / label.canvas.height;
    label.texture.needsUpdate = true;
  }

  private sizeLabel(label: MapLabel, zoom: number, pixels: number) {
    const height = pixels / Math.max(.1, zoom);
    label.sprite.scale.set(height * label.width, height, 1);
  }

  extent(): { bounds: Bounds; heights: [number, number] } {
    const points = this.pathPoints.length ? this.pathPoints : [this.position];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const point of points) { x0 = Math.min(x0, point[0]); x1 = Math.max(x1, point[0]); z0 = Math.min(z0, point[1]); z1 = Math.max(z1, point[1]); const height = this.height(point); y0 = Math.min(y0, height); y1 = Math.max(y1, height); }
    return { bounds: [x0 - 10, x1 + 10, z0 - 10, z1 + 10], heights: [y0, y1 + 4] };
  }

  stats() { return { position: this.state.position, status: this.state.status, active: this.state.active, pathPoints: this.pathPoints.length, completedDistance: this.targetDistance, stops: this.stops.length }; }

  private clearStops() {
    for (const stop of this.stops) {
      this.group.remove(stop.group, stop.label.sprite);
      stop.circle.geometry.dispose(); stop.label.texture.dispose(); stop.label.material.dispose();
    }
    this.stops = [];
  }

  dispose() {
    this.clearStops();
    const geometries = new Set<THREE.BufferGeometry>();
    this.rider.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
    geometries.forEach(geometry => geometry.dispose());
    this.route.geometry.dispose(); this.completed.geometry.dispose();
    this.routeMaterial.dispose(); this.completedMaterial.dispose();
    this.warm.dispose(); this.lid.dispose(); this.stopMaterial.dispose(); this.doneMaterial.dispose();
    this.riderLabel.texture.dispose(); this.riderLabel.material.dispose();
    this.group.clear();
  }
}
