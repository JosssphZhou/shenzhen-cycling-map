import type { Coordinate } from '@/lib/types';

export type CourierBrand = 'meituan' | 'eleme';

/** 外卖体验原型交给现有城市绘制器的数据，不包含计时或结算逻辑。 */
export interface DeliverySceneState {
  brand?: CourierBrand;
  position: Coordinate;
  path: Coordinate[];
  completedPath: Coordinate[];
  stops: { coordinate: Coordinate; label: string; kind: 'pickup' | 'dropoff'; done: boolean }[];
  status: string;
  active: boolean;
}
