import type { Coordinate, Source } from '@/lib/types';

export interface MapPolygon { id: string; name?: string; kind: string; rings: Coordinate[][] }
export interface MapRoad { id: string; name?: string; kind: string; points: Coordinate[] }
export interface MapDistrict { name: string; center: Coordinate; rings: Coordinate[][] }
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
  sources: Source[];
  generated: string;
  statistics: Record<string, unknown>;
}
