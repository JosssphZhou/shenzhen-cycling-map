import type { Metadata } from 'next';
import './globals.css';

// 与 Factory 一样在首屏绘制前恢复主题，未设置时跟随系统。
const restoreTheme = `try{var t=localStorage.getItem('shenzhen-yard-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: '深圳骑行地图 · 骑前选线',
  description: '在地标锚定的深圳微缩城市里，寻找下一条公路车路线。查看路况、通行限制与来源，导出可用轨迹。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: restoreTheme }} /></head>
    <body>{children}</body>
  </html>;
}
