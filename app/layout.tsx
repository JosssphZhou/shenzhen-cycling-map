import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '深圳骑行地图 · 骑前选线',
  description: '在地标锚定的深圳微缩城市里，寻找下一条公路车路线。查看路况、通行限制与来源，导出可用轨迹。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" data-theme="light"><body>{children}</body></html>;
}
