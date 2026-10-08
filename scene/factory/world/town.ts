// @ts-nocheck
import * as THREE from 'three';
import { FRONT, SIDE, TOP, W } from '../kernel/iso';
import { Part, pose } from '../kernel/part';
import { rng, rand } from '../kernel/math';
import { CURB } from '../layout';

// ---- town buildings ----
// windows on one face, in rows from the top; at night only some of them light up
function windows(p, M, w, h, { x0 = 1.2, y0 = 1.0, ww = 1.4, wh = 1.5, dx = 3, dy = 3, skip = () => false, lit = 0.6 } = {}) {
  for (let v = y0; v + wh <= h - 0.4; v += dy) for (let u = x0; u + ww <= w - 0.3; u += dx) {
    if (skip(u, v)) continue;
    p.fill2(M, u, v, ww, wh, rng() < lit ? 'window' : 'glass').rect2(M, u, v, ww, wh, 'line', 0.04);
  }
}
export function buildFlats(name, x, y, w, d, h, door) {
  const p = new Part(), z = CURB;
  p.box(x, y, z, w, d, h);
  p.box(x - 0.25, y - 0.25, z + h, w + 0.5, d + 0.5, 0.45);
  const F = FRONT(x, y + d, z + h), S = SIDE(x + w, y + d, z + h);
  windows(p, F, w, h, { skip:(u, v) => v > h - 3.5 && Math.abs(u + 0.7 - door) < 2.6 });
  windows(p, S, d, h, { x0:1.4 });
  for (let v = 3; v < h; v += 3) { p.draw(F, [0, v - 0.25, w, v - 0.25]); p.draw(S, [0, v - 0.25, d, v - 0.25]); }
  p.fill2(F, door - 1.1, h - 2.7, 2.2, 2.7).rect2(F, door - 1.1, h - 2.7, 2.2, 2.7, 'line');
  p.box(x + door - 1.8, y + d, z + 2.8, 3.6, 1.4, 0.18);
  p.text(F, name.toUpperCase(), door + 2.2, h - 2.0, 0.55);
  for (const [dx, dy] of [[3, 3], [w - 7, 4]]) { p.box(x + dx, y + dy, z + h + 0.45, 3.6, 2.6, 1.3); p.draw(FRONT(x + dx, y + dy + 2.6, z + h + 1.75), [0.4, 0.4, 3.2, 0.4, 0.4, 0.75, 3.2, 0.75]); }
  p.cylZ(x + w / 2, y + d / 2, z + h + 0.45, 1.3, 2.2, 12);
  return p.build('flats');
}

import { tree, palm } from './ground';
import { buildCar } from '../models/vehicles';

export function buildHouse(o) {
  const { x, y, w, d, h, rh = 3, ridgeY = false, door = 2, lotY1, lotX0, lotX1, car, garage = 0, porch = false, dormer = false } = o, z = CURB, ov = 0.5;
  const p = o.gardens ?? new Part(), s = new Part();
  s.box(x, y, z, w, d, h);
  if (ridgeY) {
    s.extrude([[x - ov, y - ov, z + h - 0.12], [x + w / 2, y - ov, z + h + rh], [x + w + ov, y - ov, z + h - 0.12]], [0, d + 2 * ov, 0]);
    for (let t = 0.2; t < 1; t += 0.2) { const xx = x + w / 2 + t * (w / 2 + ov), zz = z + h + rh - t * (rh + 0.12); s.seg('detail', W(xx, y - ov, zz), W(xx, y + d + ov, zz)); }
    const gf = FRONT(x, y + d + ov, z + h);
    s.fill2(gf, w / 2 - 0.6, -1.6, 1.2, 1.0, rng() < 0.5 ? 'window' : 'glass').rect2(gf, w / 2 - 0.6, -1.6, 1.2, 1.0, 'line');
  } else {
    s.extrude([[x - ov, y - ov, z + h - 0.12], [x - ov, y + d / 2, z + h + rh], [x - ov, y + d + ov, z + h - 0.12]], [w + 2 * ov, 0, 0]);
    for (let t = 0.2; t < 1; t += 0.2) { const yy = y + d / 2 + t * (d / 2 + ov), zz = z + h + rh - t * (rh + 0.12); s.seg('detail', W(x - ov, yy, zz), W(x + w + ov, yy, zz)); }
  }
  s.box(x + w * 0.72, y + d * 0.3, z + h + rh * 0.35, 0.7, 0.7, rh * 0.85);
  const F = FRONT(x, y + d, z + h), S = SIDE(x + w, y + d, z + h);
  s.fill2(F, door, h - 2.2, 1.1, 2.2).rect2(F, door, h - 2.2, 1.1, 2.2, 'line');
  for (let u = 0.9; u + 1.3 < w - 0.4; u += 2.6) { if (Math.abs(u - door) < 1.6) continue; s.fill2(F, u, h - 1.9, 1.3, 1.1, rng() < 0.55 ? 'window' : 'glass').rect2(F, u, h - 1.9, 1.3, 1.1, 'line'); }
  if (h > 4.5) for (let u = 0.9; u + 1.3 < w - 0.4; u += 2.6) s.fill2(F, u, 0.8, 1.3, 1.1, rng() < 0.4 ? 'window' : 'glass').rect2(F, u, 0.8, 1.3, 1.1, 'line');
  for (let u = 1.2; u + 1.3 < d - 0.4; u += 3) s.fill2(S, u, h - 1.9, 1.3, 1.1, rng() < 0.5 ? 'window' : 'glass').rect2(S, u, h - 1.9, 1.3, 1.1, 'line');
  // a dormer on the front slope of the roof, with a lit window at night
  if (dormer && !ridgeY) {
    const roofAt = yy => z + h + rh - (yy - y - d / 2) / (d / 2 + ov) * (rh + 0.12), yf = y + d * 0.8, dx = x + w * 0.3 - 0.9, zb = roofAt(yf), zt = z + h + rh - 0.35;
    s.box(dx, y + d / 2 + 0.3, zb, 1.8, yf - y - d / 2 - 0.3, zt - zb).box(dx - 0.15, y + d / 2 + 0.2, zt, 2.1, yf - y - d / 2 - 0.1, 0.12);
    s.fill2(FRONT(dx, yf, zt), 0.4, 0.25, 1.0, zt - zb - 0.5, 'window').rect2(FRONT(dx, yf, zt), 0.4, 0.25, 1.0, zt - zb - 0.5, 'line');
  }
  // a porch roof on two posts over the front door
  if (porch) { p.box(x + door - 0.5, y + d, z + 2.45, 2.1, 1.5, 0.12); for (const dx of [-0.4, 1.4]) p.box(x + door + dx, y + d + 1.3, z, 0.12, 0.12, 2.45); }
  // a flat-roofed garage beside the house, its roller door to the street
  if (garage) {
    const gx = x + w + 0.2, G = FRONT(gx, y + d, z + 2.8);
    p.box(gx, y + 1.5, z, garage, d - 1.5, 2.8).box(gx - 0.1, y + 1.4, z + 2.8, garage + 0.2, d - 1.3, 0.12);
    p.rect2(G, 0.35, 0.5, garage - 0.7, 2.3, 'line'); for (let v = 0.8; v < 2.8; v += 0.3) p.draw(G, [0.35, v, garage - 0.35, v]);
  }
  // garden: a path to the pavement, a picket fence with a gap, a hedge at the back, a tree
  const px = x + door + 0.55, L = TOP(0, 0, z);
  p.fill2(L, px - 0.6, y + d, 1.2, lotY1 - y - d, 'deck', 0.03);
  for (const [a, b] of [[lotX0 + 0.4, px - 0.9], [px + 0.9, lotX1 - 0.4]]) {
    if (b - a < 0.5) continue;
    const n = Math.max(1, Math.round((b - a) / 1.2));
    for (let i = 0; i <= n; i++) p.seg('line', W(a + (b - a) * i / n, lotY1 - 0.4, z), W(a + (b - a) * i / n, lotY1 - 0.4, z + 0.9));
    p.seg('line', W(a, lotY1 - 0.4, z + 0.7), W(b, lotY1 - 0.4, z + 0.7));
  }
  p.box(lotX0 + 0.4, y - 7.5, z, lotX1 - lotX0 - 0.8, 0.9, 1.2, 'gs');
  tree(p, rand(lotX0 + 2.5, lotX1 - 2.5), y - 3.5, rand(0.8, 1.1), z);
  let c = null;
  if (car) { c = buildCar(rng() < 0.3, rng() < 0.4 ? 'k' : 'n'); p.fill2(L, car[0] - 1.6, car[1] - 5.6, 3.2, lotY1 - car[1] + 5.6, 'road', 0.03); }
  const g = new THREE.Group(); g.name = 'house';
  const shell = s.build('houseShell'); g.add(shell); if (!o.gardens) g.add(p.build('houseBase'));
  if (c) { pose(c, car[0], car[1], Math.PI / 2, z); g.add(c); }
  g.userData.chimney = [x + w * 0.72 + 0.35, y + d * 0.3 + 0.35, z + h + rh * 1.2];   // the top of the chimney stack
  return g;
}
// a villa: two flat-roofed storeys, glass bands, a pool, palms; like a house, it opens to its ground floor
export function buildVilla(o) {
  const { x, y, w, bw, bd, pool, lotY1 } = o, p = o.gardens ?? new Part(), s = new Part(), z = CURB;
  const bx = x + 3, by = y + 7;
  s.box(bx, by, z, bw, bd, 3.6);
  s.box(bx - 0.4, by - 0.4, z + 3.6, bw + 0.8, bd + 0.8, 0.3);
  s.box(bx + 5, by + 1.5, z + 3.9, bw - 8, bd - 4, 3.1);
  s.box(bx + 4.6, by + 1.1, z + 7.0, bw - 7.2, bd - 3.2, 0.3);
  const F1 = FRONT(bx, by + bd, z + 3.6), F2 = FRONT(bx + 5, by + 1.5 + bd - 4, z + 7.0);
  s.fill2(F1, 1.2, 0.5, bw - 6, 2.7, 'window').rect2(F1, 1.2, 0.5, bw - 6, 2.7, 'line');
  for (let u = 3.2; u < bw - 5; u += 2) s.draw(F1, [u, 0.5, u, 3.2], 'line');
  s.fill2(F1, bw - 3.6, 0.9, 1.4, 2.7).rect2(F1, bw - 3.6, 0.9, 1.4, 2.7, 'line');
  s.fill2(F2, 1, 0.5, bw - 10, 2.0, rng() < 0.6 ? 'window' : 'glass').rect2(F2, 1, 0.5, bw - 10, 2.0, 'line');
  const S1 = SIDE(bx + bw, by + bd, z + 3.6);
  s.fill2(S1, 1.5, 0.6, bd - 3, 1.6, rng() < 0.5 ? 'window' : 'glass').rect2(S1, 1.5, 0.6, bd - 3, 1.6, 'line');
  // terrace and pool
  const L = TOP(0, 0, z);
  p.box(pool[0] - 0.8, pool[1] - 0.8, z, pool[2] + 1.6, pool[3] + 1.6, 0.12);
  p.fill2(TOP(0, 0, z + 0.12), pool[0], pool[1], pool[2], pool[3], 'sea', 0.02).rect2(TOP(0, 0, z + 0.12), pool[0], pool[1], pool[2], pool[3], 'line', 0.03);
  for (let k = 0; k < 3; k++) p.draw(TOP(0, 0, z + 0.12), [pool[0] + 1 + k * 2.6, pool[1] + pool[3] * 0.4, pool[0] + 2.2 + k * 2.6, pool[1] + pool[3] * 0.4], 'detail', 0.04);
  for (const k of [0, 1]) p.box(pool[0] + pool[2] + 1.4, pool[1] + 0.6 + k * 2, z, 1.8, 0.7, 0.35);
  p.fill2(L, bx + bw - 3.8, by + bd, 1.2, lotY1 - by - bd, 'deck', 0.03);
  // a low wall along the street with a gate, palms
  p.box(x + 0.4, lotY1 - 0.7, z, bw - 3.8 + 2.6, 0.35, 0.8); p.box(bx + bw - 1.9, lotY1 - 0.7, z, x + w - 0.4 - (bx + bw - 1.9), 0.35, 0.8);
  for (const [px, py] of o.palms) palm(p, px, py, rand(0.9, 1.15), z);
  p.box(x + 0.4, y + 1.2, z, w - 0.8, 0.9, 1.3, 'gs');
  const g = new THREE.Group(); g.name = 'villa';
  const shell = s.build('villaShell'); g.add(shell); if (!o.gardens) g.add(p.build('villaBase'));
  return g;
}
