export type Coordinate = [number, number]; // WGS84，经度、纬度
export interface Source { title: string; url: string; published?: string; checked: string }
export interface CyclingRoute {
  id: string; name: string; districts: string[]; summary: string;
  start: string; end: string; distanceKm: number | null; distanceNote: string;
  ascentM: number | null; ascentNote: string; surface: string; roadBike: string;
  intensity: '轻松' | '进阶' | '挑战' | '待核'; status: '可选' | '有条件' | '待核';
  restrictions: string[]; bestFor: string; highlights: string[];
  anchor: Coordinate; geometry: Coordinate[][]; geometryStatus: '已核对路网' | '待核';
  geometryNote: string; osmWayIds?: number[]; exportable: boolean; sources: Source[];
  weekdayOnly?: boolean; hours?: string; services: string;
}
