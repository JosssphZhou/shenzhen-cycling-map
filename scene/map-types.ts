import type { Coordinate, Source } from '@/lib/types';
import type { Group } from 'three';

export interface MapPolygon {
  id: string;
  name?: string;
  kind: string;
  /** 一个外环及其孔洞；多个独立面分别保存。 */
  rings: Coordinate[][];
  /** 建筑顶高和底高均以米保存，渲染层统一换算场景比例。 */
  height?: number;
  minHeight?: number;
  heightSource?: string;
}
export interface MapRoad { id: string; name?: string; kind: string; points: Coordinate[] }
export interface MapDistrict { name: string; center: Coordinate; rings: Coordinate[][] }
export interface TerrainGrid {
  bounds: [number, number, number, number];
  width: number;
  height: number;
  /** 米，EGM2008；从北向南逐行，每行从西向东，包含边界顶点。 */
  values: number[];
}
export interface BuildingTile {
  id: string;
  url: string;
  bounds: [number, number, number, number];
  /** 建筑面数量，不包含细路。 */
  count: number;
  cache?: { url: string; bytes: number; buildings: number };
}
export interface BuildingTileData { buildings: MapPolygon[]; roads: MapRoad[] }
export interface ClippedTerrainData {
  /** 每九个数为一个三角面：经度、纬度、高程（米），重复三次。 */
  positions: number[];
  bounds: [number, number, number, number];
  coordinateSystem: 'WGS84';
  heightDatum: 'EGM2008';
  heightUnit: '米';
  source: string;
  statistics: Record<string, unknown>;
}
export interface MapLandmark {
  id: string;
  name: string;
  model: 'spring-bamboo' | 'cocoon' | 'pingan' | 'civic-center' | 'kk100';
  coordinate: Coordinate;
  rings: Coordinate[][];
  height?: number;
  sourceId: string;
}
export interface ShenzhenMapData {
  version: 1;
  bounds: [number, number, number, number];
  center: Coordinate;
  land: MapPolygon[];
  water: MapPolygon[];
  roads: MapRoad[];
  districts: MapDistrict[];
  landmarks: MapLandmark[];
  /** 轻量快照没有这些图层；完整城市快照全部提供。 */
  buildings?: MapPolygon[];
  terrain?: TerrainGrid;
  buildingTiles?: BuildingTile[];
  sources: Source[];
  generated: string;
  statistics: Record<string, unknown>;
  fastCity?: {
    version: 1;
    baseUrl: string;
    roadsUrl: string;
    terrainUrl: string;
    overviewUrl: string;
    roadCount: number;
    overviewBuildings: number;
    renderedOverviewBuildings: number;
    overviewOrphans: number;
  };
  /** 只由加载器写入的已解码缓冲；不属于JSON里的来源数据。 */
  cachedGeometry?: Map<string, Group>;
}
