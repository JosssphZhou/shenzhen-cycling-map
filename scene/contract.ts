import type { CyclingRoute } from '@/lib/types';

/** Factory 的对象卡合同，内容替换为深圳地标与骑行资料。 */
export interface SceneSelection {
  id: string;
  kind: string;
  title: string;
  status: string;
  rows: [string, string][];
  followable: boolean;
  following: boolean;
  routeId?: string;
  relatedRouteIds: string[];
}
export interface SceneSnapshot {
  selectionRevision?: number;
  selection: SceneSelection | null;
  clock: string;
  phase: string;
  paused: boolean;
  theme: 'light' | 'dark';
  activeView: number | null;
  readout: string;
}
export interface SceneController {
  zoomBy(factor: number): void;
  overview(): void;
  goView(index: number): void;
  selectRoute(route: CyclingRoute | null): void;
  clearSelection(): void;
  togglePause(): void;
  toggleTheme(): void;
  skipTime(): void;
  toggleFollow(): void;
  cycle(direction: number): void;
  focusSelection(): void;
  stats(): Record<string, unknown>;
}
export const PLACE_NAMES = ['深圳湾','福田','罗湖','盐田','大鹏','宝安','光明','龙华','龙岗','坪山','西丽','水库','银湖','梧桐'];
export const PLACE_KEYS = ['1','2','3','4','5','6','7','8','9','P','E','V','O','S'];
export const INITIAL_SNAPSHOT: SceneSnapshot = { selection: null, clock: '10:00', phase: '', paused: false, theme: 'light', activeView: null, readout: '正在载入' };
