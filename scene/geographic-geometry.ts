import * as THREE from 'three';
import type { Coordinate } from '@/lib/types';
import { Part } from './factory/kernel/part';
import type { Point, Bounds } from './entities';

/** 沿用归档 geography.ts 的局部米制投影；每场景单位为 50 米，北方为负 y。 */
export function makeProjection(center: Coordinate) {
  const eastScale = 111320 * Math.cos(center[1] * Math.PI / 180) * .02;
  const northScale = 111132 * .02;
  const project = (coordinate: Coordinate): Point => [
    (coordinate[0] - center[0]) * eastScale,
    (center[1] - coordinate[1]) * northScale,
  ];
  const point = (coordinate: Coordinate, elevation = 0) => {
    const [x, y] = project(coordinate);
    return new THREE.Vector3(x, elevation, y);
  };
  const coordinate = (point: THREE.Vector3): Coordinate => [center[0] + point.x / eastScale, center[1] - point.z / northScale];
  return { project, point, flat: point, coordinate };
}

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
