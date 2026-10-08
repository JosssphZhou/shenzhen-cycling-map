import routeData from '../public/data/routes.json';
import type { CyclingRoute } from './types';

// 原始坐标与来源由 scripts/routes-build.py 生成，发布前运行 check:data。
export const routes = routeData as unknown as CyclingRoute[];

export function findRoute(id: string): CyclingRoute | undefined {
  return routes.find((route) => route.id === id);
}
