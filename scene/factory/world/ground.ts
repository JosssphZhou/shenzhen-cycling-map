// @ts-nocheck
import * as THREE from 'three';
import { FRONT, TOP, W } from '../kernel/iso';
import { Part, v3 } from '../kernel/part';
import { rand } from '../kernel/math';
import { CURB } from '../layout';

export const crown = new THREE.IcosahedronGeometry(1, 0), cone = new THREE.ConeGeometry(1, 1, 7), roof4 = new THREE.ConeGeometry(1, 1, 4);
export const yaw = a => new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), a);
export function tree(p, x, y, s = 1, z = 0) {
  p.box(x - 0.22 * s, y - 0.22 * s, z, 0.44 * s, 0.44 * s, 2.2 * s);
  p.geo(crown, new THREE.Matrix4().compose(W(x, y, z + 2.2 * s + 1.7 * s), yaw(rand(0, 3)), v3(2 * s, 2.2 * s, 2 * s)));
}
export function pine(p, x, y, s = 1, z = 0) {
  p.box(x - 0.15 * s, y - 0.15 * s, z, 0.3 * s, 0.3 * s, 1.2 * s);
  p.geo(cone, new THREE.Matrix4().compose(W(x, y, z + 3.2 * s), yaw(rand(0, 3)), v3(1.5 * s, 4.4 * s, 1.5 * s)));
}
// a palm: a leaning trunk and hairline fronds
export function palm(p, x, y, s = 1, z = 0) {
  const lean = rand(-0.6, 0.6), top = W(x + lean * s, y + lean * 0.4 * s, z + 5.4 * s);
  p.geo(new THREE.CylinderGeometry(0.14, 0.22, 5.4 * s, 6), new THREE.Matrix4().compose(W(x + lean * s / 2, y + lean * 0.2 * s, z + 2.7 * s),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(lean * 0.04, 0, -lean * 0.18 / s)), v3(1, 1, 1)));
  const a0 = rand(0, 1);
  for (let i = 0; i < 7; i++) { const a = a0 + i / 7 * Math.PI * 2, c = Math.cos(a), d = Math.sin(a);
    const m = top.clone().add(v3(c * 1.5 * s, 0.35 * s, d * 1.5 * s)), e = top.clone().add(v3(c * 2.7 * s, -0.9 * s, d * 2.7 * s));
    p.seg('line', top, m).seg('line', m, e); }
  p.geo(crown, new THREE.Matrix4().compose(top, yaw(a0), v3(0.38 * s, 0.32 * s, 0.38 * s)));
}
export function lampPost(p, x, y, ax, ay, z = CURB) {
  p.box(x - 0.08, y - 0.08, z, 0.16, 0.16, 4.4);
  const hx = x + ax * 1.1, hy = y + ay * 1.1;
  p.seg('line', W(x, y, z + 4.3), W(hx, hy, z + 4.3));
  p.box(hx - 0.3, hy - 0.18, z + 4.05, 0.6, 0.36, 0.18, 'l');
}
// a bench facing n, s, e or w: seat, backrest on the far side, two legs
// Mill Park's benches; walkers who stop in the park sit on them
export const PARK_BENCHES = [[11, 175, 'e'], [11, 225, 'e'], [39, 225, 'w'], [25, 252.4, 'n'], [25, 147.6, 's']];
export function bench(p, x, y, face = 's', z = CURB) {
  if (face === 'n' || face === 's') { const b = face === 's' ? -0.28 : 0.2;
    p.box(x - 0.9, y - 0.25, z + 0.4, 1.8, 0.5, 0.08); p.box(x - 0.9, y + b, z + 0.48, 1.8, 0.08, 0.45); for (const dx of [-0.75, 0.65]) p.box(x + dx, y - 0.2, z, 0.1, 0.4, 0.4); }
  else { const b = face === 'e' ? -0.28 : 0.2;
    p.box(x - 0.25, y - 0.9, z + 0.4, 0.5, 1.8, 0.08); p.box(x + b, y - 0.9, z + 0.48, 0.08, 1.8, 0.45); for (const dy of [-0.75, 0.65]) p.box(x - 0.2, y + dy, z, 0.4, 0.1, 0.4); }
}
export const ring = (cx, cy, r, z, n = 40) => { const s = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
  s.push(W(cx + r * Math.cos(a), cy + r * Math.sin(a), z), W(cx + r * Math.cos(b), cy + r * Math.sin(b), z)); } return s; };
