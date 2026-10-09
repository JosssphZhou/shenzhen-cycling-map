import type * as THREE from 'three';

export type Point = [number, number];
export type Bounds = [number, number, number, number, ...number[]];
export interface ScenePath {
  length: number;
  closed: boolean;
  at(distance: number): { x: number; y: number; h: number } | undefined;
}
export interface MiniMovement {
  kind: 'car' | 'person' | 'train' | 'ship' | 'bicycle';
  path: Point[]; count: number; speed: number; height?: number; closed?: boolean;
  routeId?: string; scale?: number;
}
export interface MiniEntity {
  id: string; kind: string; title: string; groups: THREE.Group[];
  relatedRouteIds: string[]; followable: boolean;
  /** 仅静态路线用于打开骑行卡；活动骑友仍显示跟随卡。 */
  routeId?: string;
  info(): { title?: string; status: string; rows: [string, string][] };
  route?(): { path?: ScenePath; paths?: ScenePath[]; s: number; closed?: boolean; reverse?: boolean; next?: { x: number; y: number; name?: string } };
  bbox?(): THREE.Box3;
  resolve?(point: THREE.Vector3): MiniEntity | null;
}

/** 原始轨迹的逐段线性采样。保留每个拐点，既不圆滑，也不补连断段。 */
export class ExactPath implements ScenePath {
  readonly length: number;
  private segments: { a: Point; b: Point; start: number; length: number; h: number }[] = [];
  constructor(points: Point[], readonly closed = false) {
    let distance = 0;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length <= 1e-9) continue;
      this.segments.push({ a, b, start: distance, length, h: Math.atan2(b[1] - a[1], b[0] - a[0]) }); distance += length;
    }
    this.length = distance;
  }
  at(distance: number) {
    if (!this.length) return undefined;
    const s = this.closed ? ((distance % this.length) + this.length) % this.length : Math.max(0, Math.min(this.length, distance));
    let low = 0, high = this.segments.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2), segment = this.segments[middle]; if (segment.start + segment.length < s) low = middle + 1; else high = middle; }
    const segment = this.segments[low], fraction = (s - segment.start) / segment.length;
    return { x: segment.a[0] + (segment.b[0] - segment.a[0]) * fraction, y: segment.a[1] + (segment.b[1] - segment.a[1]) * fraction, h: segment.h };
  }
  /** 一条虚线跨过拐点时，也按真实顶点切成多条线，防止切弯。 */
  segmentsBetween(start: number, end: number): [Point, Point][] {
    const result: [Point, Point][] = [];
    if (!this.length || end <= start) return result;
    let cursor = this.closed ? start : Math.max(0, start), until = this.closed ? end : Math.min(this.length, end);
    while (cursor < until - 1e-9) {
      const localStart = this.closed ? ((cursor % this.length) + this.length) % this.length : cursor;
      const localEnd = Math.min(this.length, localStart + until - cursor);
      for (const segment of this.segments) {
        const from = Math.max(localStart, segment.start), to = Math.min(localEnd, segment.start + segment.length);
        if (to <= from) continue;
        const point = (s: number): Point => { const f = (s - segment.start) / segment.length; return [segment.a[0] + (segment.b[0] - segment.a[0]) * f, segment.a[1] + (segment.b[1] - segment.a[1]) * f]; };
        result.push([point(from), point(to)]);
      }
      cursor += localEnd - localStart;
    }
    return result;
  }
}

/** 沿原线段细分并采样地形，只增加高度，不偏移平面轨迹。 */
export function terrainSegment(a: Point, b: Point, surfaceHeight: (point: Point) => number, step = .4, lift = .24): number[] {
  const divisions = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(.01, step)));
  const positions: number[] = [];
  const point = (index: number): Point => [a[0] + (b[0] - a[0]) * index / divisions, a[1] + (b[1] - a[1]) * index / divisions];
  let previous = a;
  for (let index = 1; index <= divisions; index++) {
    const next = point(index);
    positions.push(previous[0], surfaceHeight(previous) + lift, previous[1], next[0], surfaceHeight(next) + lift, next[1]);
    previous = next;
  }
  return positions;
}
