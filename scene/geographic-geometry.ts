import * as THREE from 'three';
import type { Coordinate } from '@/lib/types';
import type { ShenzhenMapData, TerrainGrid } from './map-types';
import { Part } from './factory/kernel/part';
import type { Point, Bounds } from './entities';

export const MAP_SCALE = .02;

/** 沿用归档 geography.ts 的米制投影及真实高程双线性插值，统一缩为每单位 50 米。 */
export function makeProjection(center: Coordinate, terrain?: TerrainGrid) {
  const eastScale = 111320 * Math.cos(center[1] * Math.PI / 180) * MAP_SCALE;
  const northScale = 111132 * MAP_SCALE;
  const project = (coordinate: Coordinate): Point => [
    (coordinate[0] - center[0]) * eastScale,
    (center[1] - coordinate[1]) * northScale,
  ];
  const height = (coordinate: Coordinate) => {
    if (!terrain) return 0;
    const [west, south, east, north] = terrain.bounds;
    const u = (coordinate[0] - west) / (east - west) * (terrain.width - 1);
    const v = (north - coordinate[1]) / (north - south) * (terrain.height - 1);
    if (u < 0 || v < 0 || u > terrain.width - 1 || v > terrain.height - 1) return 0;
    const x = Math.min(terrain.width - 2, Math.floor(u)), y = Math.min(terrain.height - 2, Math.floor(v));
    const tx = u - x, ty = v - y;
    const at = (a: number, b: number) => Math.max(0, terrain.values[b * terrain.width + a] || 0);
    return ((at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty)
      + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty) * MAP_SCALE;
  };
  const flat = (coordinate: Coordinate, elevation = 0) => {
    const [x, y] = project(coordinate);
    return new THREE.Vector3(x, elevation, y);
  };
  const point = (coordinate: Coordinate, lift = 0) => flat(coordinate, height(coordinate) + lift);
  const coordinate = (point: THREE.Vector3): Coordinate => [center[0] + point.x / eastScale, center[1] - point.z / northScale];
  const terrainStep = terrain ? Math.min((terrain.bounds[2] - terrain.bounds[0]) * eastScale / (terrain.width - 1), (terrain.bounds[3] - terrain.bounds[1]) * northScale / (terrain.height - 1)) : 5;
  return { project, point, flat, height, coordinate, terrainStep };
}
export type Projection = ReturnType<typeof makeProjection>;

/** 旧建筑和道路几何继续以米计算，完成后整体缩放，不改旧高度/路宽/等高线参数。 */
export function meterProjection(projection: Projection) {
  return {
    height: (coordinate: Coordinate) => projection.height(coordinate) / MAP_SCALE,
    point: (coordinate: Coordinate, lift = 0) => projection.point(coordinate, lift * MAP_SCALE).multiplyScalar(1 / MAP_SCALE),
    flat: (coordinate: Coordinate, elevation = 0) => projection.flat(coordinate, elevation * MAP_SCALE).multiplyScalar(1 / MAP_SCALE),
  };
}
export type MeterProjection = ReturnType<typeof meterProjection>;

/** 直接沿用归档 GeometryBatch 的 Part 合批与 Earcut 孔洞三角化。 */
export class GeometryBatch {
  private part = new Part();
  triangle(tone: string, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    this.part.tri(tone === 'live' ? 'livef' : tone, a, b, c);
  }
  segment(tone: string, a: THREE.Vector3, b: THREE.Vector3) {
    if (a.distanceToSquared(b) > .000001) this.part.seg(tone, a, b);
  }
  path(tone: string, points: THREE.Vector3[], close = false) {
    for (let i = 1; i < points.length; i++) this.segment(tone, points[i - 1], points[i]);
    if (close && points.length > 2) this.segment(tone, points[points.length - 1], points[0]);
  }
  polygon(tone: string, rings: THREE.Vector3[][]) {
    const clean = rings.map(ring => {
      const end = ring.length > 1 && ring[0].distanceToSquared(ring[ring.length - 1]) < .000001 ? ring.length - 1 : ring.length;
      return ring.slice(0, end);
    }).filter(ring => ring.length >= 3);
    if (!clean.length) return;
    const flat = clean.flat();
    const faces = THREE.ShapeUtils.triangulateShape(
      clean[0].map(point => new THREE.Vector2(point.x, point.z)),
      clean.slice(1).map(ring => ring.map(point => new THREE.Vector2(point.x, point.z))),
    );
    for (const face of faces) this.triangle(tone, flat[face[0]], flat[face[1]], flat[face[2]]);
  }
  build(name: string): THREE.Group { return this.part.build(name); }
}

/** 可离线调用的原海陆、河湖与区界构造；运行时只恢复相同Float32缓冲。 */
export function buildCityBase(data: ShenzhenMapData, projection: Projection) {
  const [west, south, east, north] = data.bounds, extent = boundsOf([projection.project([west, north]), projection.project([east, south])]);
  const sea = new GeometryBatch(), land = new GeometryBatch(), water = new GeometryBatch(), districts = new GeometryBatch();
  sea.polygon('sea', [[new THREE.Vector3(extent[0] - 15, -.12, extent[2] - 15), new THREE.Vector3(extent[1] + 15, -.12, extent[2] - 15), new THREE.Vector3(extent[1] + 15, -.12, extent[3] + 15), new THREE.Vector3(extent[0] - 15, -.12, extent[3] + 15)]]);
  for (const polygon of data.land) {
    land.polygon('ground', polygon.rings.map(ring => ring.map(coordinate => projection.flat(coordinate, 0))));
    for (const ring of polygon.rings) land.path('line', ring.map(coordinate => projection.flat(coordinate, .025)), true);
  }
  for (const polygon of data.water) {
    const elevations = polygon.rings[0].map(coordinate => projection.height(coordinate)).sort((a, b) => a - b), height = (elevations[Math.floor(elevations.length / 3)] || 0) + MAP_SCALE;
    water.polygon('sea', polygon.rings.map(ring => ring.map(coordinate => projection.flat(coordinate, height))));
    for (const ring of polygon.rings) water.path('detail', ring.map(coordinate => projection.flat(coordinate, height + .02)), true);
  }
  for (const district of data.districts) for (const ring of district.rings) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < ring.length; i++) {
      if (i > 0) {
        const a = projection.project(ring[i - 1]), b = projection.project(ring[i]);
        const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(.2, projection.terrainStep / 2));
        for (let step = 1; step < count; step++) {
          const point = new THREE.Vector3(a[0] + (b[0] - a[0]) * step / count, 0, a[1] + (b[1] - a[1]) * step / count);
          point.y = projection.height(projection.coordinate(point)) + .12; points.push(point);
        }
      }
      const endpoint = projection.flat(ring[i]); endpoint.y = projection.height(projection.coordinate(endpoint)) + .12; points.push(endpoint);
    }
    districts.path('detail', points, true);
  }
  return new Map([['base/sea', sea.build('海面')], ['base/land', land.build('真实陆地与海岸')], ['base/water', water.build('真实河湖')], ['base/districts', districts.build('真实行政区界')]]);
}

export function boundsOf(points: Point[], padding = 0): Bounds {
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  return [Math.min(...xs) - padding, Math.max(...xs) + padding, Math.min(...ys) - padding, Math.max(...ys) + padding];
}
export const insideBounds = ([x, y]: Point, [x0, x1, y0, y1]: Bounds, padding = 0) => x >= x0 - padding && x <= x1 + padding && y >= y0 - padding && y <= y1 + padding;
export function pointInRing([x, y]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export const pointInPolygon = (point: Point, rings: Point[][]) => Boolean(rings[0] && pointInRing(point, rings[0]) && !rings.slice(1).some(ring => pointInRing(point, ring)));
export function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}
