// @ts-nocheck
// 原样摘取 Factory 的 buildMotorboat，未带入固定灯塔与海岸布局。
import { SIDE, FRONT, W } from '../kernel/iso';
import { Part } from '../kernel/part';

export function buildMotorboat() {
  const p = new Part();
  p.extrude([[-3.2, -1.1, -0.3], [2, -1.1, -0.3], [3.8, 0, -0.3], [2, 1.1, -0.3], [-3.2, 1.1, -0.3]], [0, 0, 0.9]);
  p.box(-1.8, -0.85, 0.6, 2.4, 1.7, 0.9);
  p.box(-2.0, -0.95, 1.5, 2.8, 1.9, 0.12);
  const f = SIDE(0.6, 0.85, 1.5); p.fill2(f, 0.15, 0.1, 1.4, 0.55).rect2(f, 0.15, 0.1, 1.4, 0.55, 'line');
  for (const y of [-0.9, 0.9]) p.seg('detail', W(-3.2, y, -0.3), W(-9, y * 3.2, -0.3));
  return p.build('motorboat');
}
