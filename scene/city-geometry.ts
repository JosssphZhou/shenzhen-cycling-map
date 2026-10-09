import * as THREE from 'three';
import type { MapPolygon, ShenzhenMapData, TerrainGrid } from './map-types';
import { GeometryBatch, MAP_SCALE, type MeterProjection } from './geographic-geometry';

// 建筑挤出、楼层示意、道路面宽与裁海高程原样复用归档 geometry.ts，只有类型和整体比例适配。
export function buildBuildings(buildings: MapPolygon[], projection: MeterProjection, detailed = false) {
  const batch = new GeometryBatch(), detail = new GeometryBatch();
  for (const building of buildings) {
    if (!building.rings[0]?.length) continue;
    const minimum = Math.max(0, (building as MapPolygon & { minHeight?: number }).minHeight || 0);
    const height = Math.max(1, Math.min(building.height || 12, 650) - minimum);
    const base = Math.min(...building.rings[0].map(p => projection.height(p))) + minimum;
    const rings = building.rings.map(ring => ring.map(p => projection.flat(p, base)));
    const roofs = rings.map(ring => ring.map(p => p.clone().add(new THREE.Vector3(0, height, 0))));
    batch.polygon('deck', roofs);
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r], top = roofs[r];
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        if (ring[i].distanceToSquared(ring[j]) < .01) continue;
        batch.triangle('body', ring[i], ring[j], top[i]);
        batch.triangle('body', ring[j], top[j], top[i]);
        batch.segment('line', top[i], top[j]);
        batch.segment('detail', ring[i], top[i]);
        if (detailed && r === 0 && height >= 9) {
          const length = ring[i].distanceTo(ring[j]);
          const floors = Math.min(16, Math.floor(height / 4));
          const columns = Math.min(12, Math.floor(length / 4.5));
          const direction = ring[j].clone().sub(ring[i]).normalize();
          if (columns > 0) for (let floor = 1; floor < floors; floor++) {
            const y = base + floor / floors * height;
            for (let column = 0; column < columns; column++) {
              const start = ring[i].clone().addScaledVector(direction, (column + .2) / columns * length).setY(y);
              const end = ring[i].clone().addScaledVector(direction, (column + .75) / columns * length).setY(y);
              const highA = start.clone().add(new THREE.Vector3(0, Math.min(2, height / floors * .55), 0));
              const highB = end.clone().add(new THREE.Vector3(0, Math.min(2, height / floors * .55), 0));
              detail.segment('detail', start, end); detail.segment('detail', highA, highB);
              detail.segment('detail', start, highA); detail.segment('detail', end, highB);
              if ((floor + column) % 4 === 0) {
                detail.triangle('window', start, end, highA); detail.triangle('window', end, highB, highA);
              }
            }
          }
        }
        // 真正高楼的立面分层使用同一批线，不增加逐窗物体。
        if (height > 80 && r === 0) {
          for (let y = 18; y < height - 8; y += 18) {
            const aa = ring[i].clone().setY(base + y), bb = ring[j].clone().setY(base + y);
            batch.segment('detail', aa, bb);
          }
        }
      }
    }
  }
  const group = batch.build('真实建筑'); group.scale.setScalar(MAP_SCALE);
  if (detailed) { const facade = detail.build( '立面示意细节'); facade.visible = false; group.add(facade); }
  return group;
}

const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
export const isMajor = (kind: string) => MAJOR.has(kind);
export function buildRoads(city: Pick<ShenzhenMapData, 'roads'>, projection: MeterProjection) {
  const major = new GeometryBatch(), minor = new GeometryBatch(), paths = new GeometryBatch(), rail = new GeometryBatch();
  for (const road of city.roads) {
    if (road.points.length < 2 || road.kind === 'ferry') continue;
    const batch = road.kind === 'railway' ? rail : isMajor(road.kind) ? major : ['cycleway', 'footway', 'path', 'pedestrian'].includes(road.kind) ? paths : minor;
    const points = road.points.map(p => projection.point(p, road.kind === 'railway' ? 3 : 1.6));
    batch.path(road.kind === 'railway' ? 'detail' : batch === paths ? 'detail' : 'line', points);
    if (batch !== paths && road.kind !== 'railway') {
      const width = isMajor(road.kind) ? 12 : 5;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const normal = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(width / 2);
        batch.triangle('road', a.clone().add(normal), b.clone().add(normal), a.clone().sub(normal));
        batch.triangle('road', b.clone().add(normal), b.clone().sub(normal), a.clone().sub(normal));
      }
    }
  }
  const result = {
    major: major.build( '主干道路'), minor: minor.build( '街道'),
    paths: paths.build( '慢行道路'), rail: rail.build('铁路'),
  };
  Object.values(result).forEach(group => group.scale.setScalar(MAP_SCALE));
  return result;
}
export function disposeGeometry(group: THREE.Object3D) {
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
  });
}
/** 离线按真实陆地边界裁切后的高程三角网，避免海岸被DEM格子代替。 */
export function buildClippedTerrain(positions: number[], projection: MeterProjection) {
  const batch = new GeometryBatch();
  for (let index = 0; index + 8 < positions.length; index += 9) {
    const vertices = [0, 3, 6].map(offset => projection.flat([positions[index + offset], positions[index + offset + 1]], Math.max(0, positions[index + offset + 2])));
    const high = Math.max(...vertices.map(p => p.y)), low = Math.min(...vertices.map(p => p.y));
    batch.triangle(high > 110 ? 'grass' : 'ground', vertices[0], vertices[1], vertices[2]);
    for (let elevation = Math.ceil(Math.max(50, low) / 50) * 50; elevation <= high; elevation += 50) {
      const crossings: THREE.Vector3[] = [];
      vertices.forEach((p, i) => {
        const q = vertices[(i + 1) % 3];
        if ((p.y <= elevation && q.y > elevation) || (q.y <= elevation && p.y > elevation)) crossings.push(p.clone().lerp(q, (elevation - p.y) / (q.y - p.y)).add(new THREE.Vector3(0, .4, 0)));
      });
      if (crossings.length === 2) batch.segment(elevation % 200 === 0 ? 'line' : 'detail', crossings[0], crossings[1]);
    }
  }
  const group = batch.build('真实高程'); group.scale.setScalar(MAP_SCALE); return group;
}

/** 原始 257×145 高程网格，先显示，再由裁海三角网替换。 */
export function buildGridTerrain(terrain: TerrainGrid, projection: MeterProjection) {
    const batch = new GeometryBatch();
    const [w, s, e, n] = terrain.bounds;
    // 保留采样网格的起伏，海面零高程不填面，海岸取数据中的陆地多边形。
    const point = (x: number, y: number) => projection.point([w + x / (terrain.width - 1) * (e - w), n - y / (terrain.height - 1) * (n - s)]);
    for (let y = 0; y < terrain.height - 1; y++) for (let x = 0; x < terrain.width - 1; x++) {
      const a = point(x, y), b = point(x + 1, y), c = point(x + 1, y + 1), d = point(x, y + 1);
      if (Math.min(a.y, b.y, c.y, d.y) < 35) continue;
      batch.triangle(Math.max(a.y, b.y, c.y) > 110 ? 'grass' : 'ground', a, b, c);
      batch.triangle(Math.max(a.y, d.y, c.y) > 110 ? 'grass' : 'ground', a, c, d);
      // 真实高程的50米等高线，以三角网线性插值。
      for (const vertices of [[a, b, c], [a, c, d]]) {
        const low = Math.min(...vertices.map(p => p.y)), high = Math.max(...vertices.map(p => p.y));
        for (let h = Math.ceil(Math.max(50, low) / 50) * 50; h <= high; h += 50) {
          const crossings: THREE.Vector3[] = [];
          vertices.forEach((p, i) => {
            const q = vertices[(i + 1) % 3];
            if ((p.y <= h && q.y > h) || (q.y <= h && p.y > h)) crossings.push(p.clone().lerp(q, (h - p.y) / (q.y - p.y)).add(new THREE.Vector3(0, .4, 0)));
          });
          if (crossings.length === 2) batch.segment(h % 200 === 0 ? 'line' : 'detail', crossings[0], crossings[1]);
        }
      }
    }
  const group = batch.build('真实高程'); group.scale.setScalar(MAP_SCALE); return group;
}
