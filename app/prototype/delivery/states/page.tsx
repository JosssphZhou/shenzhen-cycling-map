'use client';

import { useRef } from 'react';
import SelectionCard, { type CardRow } from '@/components/SelectionCard';

const scenarios: { title: string; width: number; rows: CardRow[]; status: string }[] = [
  { title: '开工，短字段', width: 380, status: '准备出发', rows: [['时长', '45分钟'], ['订单', '至少两单'], ['钱包', '¥0.00']] },
  { title: '配送，长商家与送达地址', width: 380, status: '正在等餐', rows: [['取餐', '深圳湾科技生态园南区深夜营业的潮汕砂锅粥档口'], ['送往', '粤海街道科技园办公楼东侧门收件处'], ['沿途', '后厨还在压单，骑手在档口等着取餐。']] },
  { title: '空订单，窄容器', width: 300, status: '还没有订单', rows: [['订单', '设好专注时间，系统就会安排这一趟的取送路线。']] },
  { title: '存档错误，长说明', width: 380, status: '存档需要检查', rows: [['说明', '这份原型存档格式不完整。原存档已保留，没有覆盖。请换用另一种模式体验，或允许此页面使用本地存储后重新读取。']] },
  { title: '结算，超时扣费与取消订单', width: 380, status: '提前收工', rows: [['已专注', '21分钟'], ['订单', '送达1单，取消2单'], ['配送费', '¥16.00'], ['扣费', '−¥3.00'], ['实收', '¥13.00'], ['评分', '−0.2，当前4.6'], ['足迹', '南山，福田']] },
];

function Scenario({ title, width, rows, status }: typeof scenarios[number]) {
  const ref = useRef<HTMLElement>(null);
  return <section><p>{title}（容器{width}像素）</p><div style={{ width, height: 460, position: 'relative', border: '1px solid var(--page-edge)' }}><SelectionCard cardRef={ref} hidden={false} page="states" kind="外卖专注，组件状态" title="这一趟，交给骑手。" status={status} rows={rows} actions={[{ label: '回到配送', onClick: () => {} }, { label: '查看订单', onClick: () => {} }]} onClose={() => {}} /></div></section>;
}

export default function DeliveryCardStatesPage() {
  return <main style={{ overflow: 'auto', padding: 12 }}><p>配送卡组件状态：开工、长字段、空订单、存档错误与提前结算。沿用项目字体和样式；未进行浏览器回看，不含视觉通过结论。</p>{scenarios.map(scenario => <Scenario key={scenario.title} {...scenario} />)}</main>;
}
