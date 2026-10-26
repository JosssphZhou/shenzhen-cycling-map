import type { Metadata } from 'next';
import DeliveryPrototype from '@/components/DeliveryPrototype';

export const metadata: Metadata = {
  title: '外卖专注，深圳体验原型',
  description: '你去专注，骑手在深圳送外卖。一个使用真实城市地图的配送与养成体验原型。',
};

export default function DeliveryPrototypePage() {
  return <DeliveryPrototype />;
}
