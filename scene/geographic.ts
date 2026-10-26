import * as THREE from 'three';
import type { CyclingRoute } from '@/lib/types';
import type { ShenzhenMapData } from './map-types';
import type { Bounds, MiniEntity, MiniMovement, Point } from './entities';
import { ExactPath } from './entities';
import { Part } from './factory/kernel/part';
import { FRONT, W } from './factory/kernel/iso';
import { LINE } from './factory/theme';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { buildLandmark } from './landmarks';
import { CityLayers } from './city-layers';
import { GeometryBatch, MAP_SCALE, boundsOf, buildCityBase, distanceToSegment, insideBounds, makeProjection, pointInPolygon } from './geographic-geometry';

interface GeographicZone {
  id: string;
  name: string;
  districts: string[];
  anchor: Point;
  bounds: Bounds;
  path: Point[];
}
interface PolygonIndex { rings: Point[][]; bounds: Bounds; name: string }
const midpoint = (bounds: Bounds): Point => [(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2];
const rectangle = (bounds: Bounds, padding = 0): Bounds => [bounds[0] - padding, bounds[1] + padding, bounds[2] - padding, bounds[3] + padding];
const boxFor = (bounds: Bounds, height = .2) => new THREE.Box3(W(bounds[0], bounds[2], .02), W(bounds[1], bounds[3], height));
const squaredArea = (bounds: Bounds) => (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]);
const districtKey = (name: string) => name.replace(/新区$|区$/g, '');

/** 真实海岸、河湖、主路与区界；仅五个有源坐标的地标使用立体地图符号。 */
export function buildGeographicScene(data: ShenzhenMapData, routes: CyclingRoute[]) {
  const projection = makeProjection(data.center, data.terrain);
  const project = projection.project;
  const surfaceHeight = (point: Point) => projection.height(projection.coordinate(W(...point)));
  const terrainStep = projection.terrainStep;
  const onSurface = (point: Point, lift: number) => W(...point, surfaceHeight(point) + lift);
  const drapedPath = (points: Point[], lift: number) => {
    const result: THREE.Vector3[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const a = points[i - 1], b = points[i], distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const subdivisions = Math.ceil(distance / Math.max(.2, terrainStep / 2));
        for (let part = 1; part < subdivisions; part++) result.push(onSurface([a[0] + (b[0] - a[0]) * part / subdivisions, a[1] + (b[1] - a[1]) * part / subdivisions], lift));
      }
      result.push(onSurface(points[i], lift));
    }
    return result;
  };
  const group = new THREE.Group(); group.name = '深圳真实地理';
  const entities: MiniEntity[] = [];
  const movements: MiniMovement[] = [];
  const [west, south, east, north] = data.bounds;
  const bounds = boundsOf([project([west, north]), project([east, south])]);
  const routePaths = new Map<string, Point[][]>();
  const routeBounds = new Map<string, Bounds>();
  const routeEntities = new Map<string, MiniEntity>();
  const indexedRoutes: { route: CyclingRoute; paths: Point[][]; anchor: Point; bounds: Bounds }[] = [];

  // 海面与真实岸线保持原始平面，高程由裁海三角网覆盖；图层微小偏移只用于消除共面闪烁。
  const base = data.cachedGeometry && ['base/sea', 'base/land', 'base/water', 'base/districts'].every(key => data.cachedGeometry?.has(key)) ? data.cachedGeometry : buildCityBase(data, projection);
  const seaGroup = base.get('base/sea')!, landGroup = base.get('base/land')!;
  group.add(seaGroup, landGroup);

  const districtIndexes: PolygonIndex[] = [];
  const zoneMap = new Map<string, GeographicZone>();
  const zoneLabelArea = new Map<string, number>();
  for (const district of data.districts) {
    const rings = district.rings.map(ring => ring.map(project));
    if (!rings[0]?.length) continue;
    const extent = boundsOf(rings[0]);
    districtIndexes.push({ rings, bounds: extent, name: district.name });
    const previous = zoneMap.get(district.name);
    if (!previous) zoneMap.set(district.name, { id: districtKey(district.name), name: district.name, districts: [districtKey(district.name)], anchor: project(district.center), bounds: extent, path: [] });
    else previous.bounds = [Math.min(previous.bounds[0], extent[0]), Math.max(previous.bounds[1], extent[1]), Math.min(previous.bounds[2], extent[2]), Math.max(previous.bounds[3], extent[3])];
    // 多面行政区以最大面的数据中心放置一次中文区名。
    if (squaredArea(extent) > (zoneLabelArea.get(district.name) ?? 0)) {
      zoneMap.get(district.name)!.anchor = project(district.center);
      zoneLabelArea.set(district.name, squaredArea(extent));
    }
  }
  group.add(base.get('base/districts')!);
  const zones = [...zoneMap.values()];
  const zoneAt = (point: Point): GeographicZone => {
    const district = districtIndexes.find(item => insideBounds(point, item.bounds) && pointInPolygon(point, item.rings));
    if (district) return zoneMap.get(district.name)!;
    return zones.reduce((nearest, zone) => Math.hypot(point[0] - zone.anchor[0], point[1] - zone.anchor[1]) < Math.hypot(point[0] - nearest.anchor[0], point[1] - nearest.anchor[1]) ? zone : nearest, zones[0] ?? { id: 'shenzhen', name: '深圳', districts: [], anchor: project(data.center), bounds, path: [] });
  };

  for (const route of routes) {
    // 真实点逐个投影，多段仍分开，候选路线没有连线。
    const paths = route.exportable && route.geometryStatus === '已核对路网'
      ? route.geometry.map(segment => segment.map(project)) : [];
    const anchor = project(route.anchor);
    const extent = paths.some(path => path.length > 1) ? boundsOf(paths.flat()) : boundsOf([anchor]);
    routePaths.set(route.id, paths);
    routeBounds.set(route.id, rectangle(extent, paths.length ? 12 : 30));
    indexedRoutes.push({ route, paths, anchor, bounds: extent });
    const exactPaths = paths.filter(path => path.length > 1).map(path => new ExactPath(path));
    const entity: MiniEntity = {
      id: `路线：${route.id}`, routeId: route.id, kind: '骑行路线', title: route.name,
      groups: [], relatedRouteIds: [route.id], followable: false,
      info: () => ({ status: route.exportable ? '已核对真实轨迹' : '候选地点，轨迹待核', rows: [['片区', route.districts.join(' · ')], ['里程', route.distanceKm === null ? '待核实' : `${route.distanceKm.toFixed(1)} 公里`], ['坐标', '真实经纬度']] }),
      bbox: () => boxFor(rectangle(extent, paths.length ? 1 : 2)),
      ...(exactPaths.length ? { route: () => ({ paths: exactPaths, s: 0, closed: false }) } : {}),
    };
    routeEntities.set(route.id, entity); entities.push(entity);
    for (const path of paths) if (path.length > 1) movements.push({ kind: 'bicycle', path, count: 2, speed: .14, height: .04, scale: .06, closed: false, routeId: route.id });
  }

  const routeDistance = (point: Point, item: typeof indexedRoutes[number]) => {
    if (!item.paths.length) return Math.hypot(point[0] - item.anchor[0], point[1] - item.anchor[1]);
    let nearest = Infinity;
    for (const path of item.paths) for (let i = 1; i < path.length; i++) nearest = Math.min(nearest, distanceToSegment(point, path[i - 1], path[i]));
    return nearest;
  };
  const relatedRoutesAt = (point: Point): string[] => {
    const nearby = indexedRoutes.filter(item => insideBounds(point, item.bounds, 100)).map(item => ({ id: item.route.id, distance: routeDistance(point, item) })).filter(item => item.distance <= 100).sort((a, b) => a.distance - b.distance);
    return nearby.slice(0, 8).map(item => item.id);
  };
  const routeAt = (point: Point): MiniEntity | null => {
    let closest: MiniEntity | null = null, threshold = 4;
    for (const item of indexedRoutes) {
      if (!insideBounds(point, item.bounds, threshold)) continue;
      const distance = routeDistance(point, item);
      if (distance < threshold) { threshold = distance; closest = routeEntities.get(item.route.id)!; }
    }
    return closest;
  };
  // 真实底面承接拾取，不新增大面积虚构可点击道路或矩形陆地。
  const basePicker: MiniEntity = {
    id: '真实底图', title: '深圳', kind: '底图', groups: [], relatedRouteIds: [], followable: false,
    info: () => ({ status: '真实地理', rows: [] }),
    resolve: point => routeAt([point.x, point.z]),
  };
  landGroup.userData.entity = basePicker;
  seaGroup.userData.entity = basePicker;

  const indexedWater: { polygon: PolygonIndex; entity: MiniEntity }[] = [];
  const waterLabels = new Map<string, { point: Point; area: number; height: number }>();
  for (const polygon of data.water) {
    const rings = polygon.rings.map(ring => ring.map(project));
    if (!rings[0]?.length) continue;
    const extent = boundsOf(rings[0]);
    const elevations = polygon.rings[0].map(coordinate => projection.height(coordinate)).sort((a, b) => a - b);
    const waterHeight = (elevations[Math.floor(elevations.length / 3)] || 0) + MAP_SCALE;
    const anchor = midpoint(extent);
    const entity: MiniEntity = {
      id: `水体：${polygon.id}`, title: polygon.name || '河湖水域', kind: '河湖', groups: [], followable: false,
      relatedRouteIds: relatedRoutesAt(anchor),
      info: () => ({ status: '真实水体轮廓', rows: [['片区', zoneAt(anchor).name], ['资料', '开放街道地图'], ['骑行', '水边通行以具体路线资料为准']] }),
      bbox: () => boxFor(extent, waterHeight + .1),
    };
    entities.push(entity);
    indexedWater.push({ polygon: { rings, bounds: extent, name: polygon.name || '' }, entity });
    const area = squaredArea(extent);
    if (polygon.name && area > 250 && area > (waterLabels.get(polygon.name)?.area ?? 0)) waterLabels.set(polygon.name, { point: anchor, area, height: waterHeight });
  }
  const waterGroup = base.get('base/water')!; group.add(waterGroup);
  waterGroup.userData.entity = {
    ...basePicker,
    resolve: (point: THREE.Vector3) => {
      const flat: Point = [point.x, point.z];
      return routeAt(flat) ?? indexedWater.find(item => insideBounds(flat, item.polygon.bounds) && pointInPolygon(flat, item.polygon.rings))?.entity ?? null;
    },
  };

  const cityLayers = new CityLayers(data, projection, basePicker);
  group.add(cityLayers.group);
  const routeLines = new GeometryBatch();
  const markers = new Part();
  for (const item of indexedRoutes) {
    if (item.paths.length) for (const path of item.paths) routeLines.path('line', drapedPath(path, .18));
    else {
      const [x, y] = item.anchor;
      // 空心标记只表示有来源的候选地点，不意味着存在骑行轨迹。
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, b = (i + 1) / 12 * Math.PI * 2;
        markers.seg('detail', onSurface([x + Math.cos(a) * 1.6, y + Math.sin(a) * 1.6], .19), onSurface([x + Math.cos(b) * 1.6, y + Math.sin(b) * 1.6], .19));
      }
    }
  }
  const routeGroup = routeLines.build('已核对骑行轨迹');
  const routeMaterial = (LINE as Record<string, LineMaterial>).live.clone();
  routeMaterial.linewidth = 1.5; routeMaterial.transparent = true; routeMaterial.opacity = .55;
  routeGroup.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (object.userData.line) { mesh.material = routeMaterial; object.userData.mapRouteLine = true; }
  });
  group.add(routeGroup, markers.build('候选路线地点'));

  // 文字继续使用 Factory 的字形纹理与材质，只有地图标注按像素维持可读大小。
  type LabelKind = 'district' | 'water' | 'landmark';
  const mapLabels: { group: THREE.Group; visual: THREE.Group; width: number; size: number; kind: LabelKind }[] = [];
  const makeLabel = (name: string, location: Point, height: number, kind: LabelKind) => {
    const size = kind === 'district' ? 13 : 12;
    const part = new Part(); part.text(FRONT(0, 0, 0), name, 0, 0, size, 'ink', 'middle');
    const visual = part.build(name) as THREE.Group;
    const width = new THREE.Box3().setFromObject(visual).getSize(new THREE.Vector3()).x;
    const label = new THREE.Group(); label.name = `${name}地图标注`; label.add(visual);
    label.position.copy(W(...location, height));
    label.userData.mapLabel = kind;
    visual.traverse(object => {
      if (object instanceof THREE.Mesh) {
        (object.material as THREE.MeshBasicMaterial).depthTest = false;
        object.renderOrder = 20; object.frustumCulled = false;
      }
    });
    mapLabels.push({ group: label, visual, width, size, kind }); group.add(label);
  };
  for (const zone of zones) makeLabel(zone.name, zone.anchor, surfaceHeight(zone.anchor) + .4, 'district');
  for (const [name, label] of waterLabels) makeLabel(name, label.point, label.height + .4, 'water');
  for (const landmark of data.landmarks) {
    const location = project(landmark.coordinate);
    const model = buildLandmark(landmark.model);
    model.scale.setScalar(landmark.model === 'cocoon' ? .09 : .1);
    model.position.copy(onSurface(location, .2));
    const entity: MiniEntity = {
      id: `地标：${landmark.id}`, title: landmark.name, kind: '深圳地标', groups: [model], followable: false,
      relatedRouteIds: relatedRoutesAt(location),
      info: () => ({ status: '真实位置 · 立体符号', rows: [['片区', zoneAt(location).name], ['位置', '有来源的建筑轮廓中心'], ['模型', '大小为示意，不表示实际高度']] }),
    };
    model.userData.entity = entity; entities.push(entity); group.add(model);
    makeLabel(landmark.name, location, new THREE.Box3().setFromObject(model).max.y + 1, 'landmark');
  }
  const priority: Record<LabelKind, number> = { landmark: 3, water: 2, district: 1 };
  mapLabels.sort((a, b) => priority[b.kind] - priority[a.kind]);
  const updateLabels = (zoom: number, camera: THREE.Camera, width: number, height: number) => {
    routeMaterial.color.copy((LINE as Record<string, LineMaterial>).live.color);
    routeMaterial.resolution.set(width, height);
    const occupied: [number, number, number, number][] = [];
    for (const label of mapLabels) {
      const near = zoom >= 1.2, allowed = label.kind === 'district' ? zoom < 1.4 : near;
      label.group.visible = allowed;
      if (!allowed) continue;
      const projected = label.group.position.clone().project(camera);
      const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
      if (x < 0 || x > width || y < 0 || y > height || Math.abs(projected.z) > 1) { label.group.visible = false; continue; }
      label.group.scale.setScalar(1 / zoom); label.group.quaternion.copy(camera.quaternion);
      // 被原作全局文字LOD隐藏过的子网格在本标注规则下恢复。
      label.visual.traverse(object => { if (object.userData.textSize) object.visible = true; });
      let placed = false;
      for (const offset of label.kind === 'landmark' ? [0, 20, -20] : [0]) {
        const box: [number, number, number, number] = [x - label.width / 2 - 4, y - label.size - offset - 4, x + label.width / 2 + 4, y - offset + 4];
        if (box[0] < 4 || box[2] > width - 4 || box[1] < 4 || box[3] > height - 4) continue;
        if (occupied.some(other => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue;
        occupied.push(box); label.visual.position.y = offset; placed = true; break;
      }
      label.group.visible = placed; label.group.updateMatrixWorld(true);
    }
  };

  const findZoneBounds = (name: string) => {
    const zone = zones.find(item => districtKey(item.name) === name);
    if (zone) return rectangle(zone.bounds, 10);
    const anchors = indexedRoutes.filter(item => item.route.districts.some(district => district.includes(name))).map(item => item.anchor);
    return anchors.length ? boundsOf(anchors, 30) : bounds;
  };
  const routeView = (id: string) => routeBounds.get(id) ?? bounds;
  const reservoir = indexedWater.find(item => item.polygon.name === '深圳水库');
  const views: Bounds[] = [
    routeView('shenzhen-bay-main'), findZoneBounds('福田'), findZoneBounds('罗湖'), findZoneBounds('盐田'),
    findZoneBounds('大鹏'), findZoneBounds('宝安'), findZoneBounds('光明'), findZoneBounds('龙华'), findZoneBounds('龙岗'), findZoneBounds('坪山'),
    routeView('xili-east'), reservoir ? rectangle(reservoir.polygon.bounds, 15) : routeView('taojinshan-main'), routeView('yinhu-main'), routeView('wutong-main'),
  ];
  group.updateMatrixWorld(true);
  return { group, entities, movements, roads: data.fastCity?.roadCount ?? data.roads.length, buildings: data.buildingTiles?.reduce((sum, tile) => sum + tile.count, 0) || data.buildings?.length || data.landmarks.length, bounds, views, project, routePaths, routeBounds, zoneAt, relatedRoutesAt, surfaceHeight, terrainStep, updateLabels, update: cityLayers.update.bind(cityLayers), stats: cityLayers.stats.bind(cityLayers), retryLayers: cityLayers.retryLayers.bind(cityLayers), dispose: () => { cityLayers.dispose(); routeMaterial.dispose(); } };
}
