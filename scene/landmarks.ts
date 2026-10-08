import * as THREE from 'three';
import { FRONT, SIDE, TOP, W } from './factory/kernel/iso';
import { Part } from './factory/kernel/part';
import { rand } from './factory/kernel/math';
import { beam } from './factory/models/works';
import { buildPerson } from './factory/models/people';
import { buildSTS, staysPart, STS } from './factory/models/port';
import { PORT } from './factory/layout';

/** 地标采用模型比例。坐标为 x 东、y 南、z 高，底面中心为原点。 */
export type LandmarkKind = 'spring-bamboo' | 'pingan' | 'civic-center' | 'kk100' | 'cocoon' | 'bay-bridge' | 'port-crane' | 'beach-tower';
const TAU = Math.PI * 2;

// 原样沿用 Factory yard/world/towers.ts 的 curtain，只补齐类型与中文注释。
// 原作的玻璃、楼层细线、夜间亮窗由同一组材质控制。
function curtain(p: Part, M: THREE.Matrix4, w: number, h: number, { bay = 1.8, floor = 3.8, lit = 0.32, glass = true, skip = 0 } = {}) {
  if (glass) p.fill2(M, 0, skip, w, h - skip, 'glass', 0.03);
  const nb = Math.max(1, Math.round(w / bay)), bw = w / nb, nf = Math.floor((h - skip) / floor), segs: number[] = [];
  for (let i = 1; i < nb; i++) segs.push(i * bw, skip, i * bw, h);
  for (let f = 1; f <= nf; f++) segs.push(0, skip + f * floor, w, skip + f * floor);
  p.draw(M, segs, 'detail', 0.04);
  for (let f = 0; f < nf; f++) for (let i = 0; i < nb; i++) if (rand(0, 1) < lit) p.fill2(M, i * bw + 0.15, skip + f * floor + 0.45, bw - 0.3, floor - 0.95, 'window', 0.035);
}

const ring = (cx: number, cy: number, rx: number, ry: number, z: number, n = 48) =>
  Array.from({ length:n }, (_, i) => W(cx + Math.cos(i / n * TAU) * rx, cy + Math.sin(i / n * TAU) * ry, z));
function outline(p: Part, points: THREE.Vector3[], k = 'line') {
  for (let i = 0; i < points.length; i++) p.seg(k, points[i], points[(i + 1) % points.length]);
}
function lineStrip(p: Part, points: THREE.Vector3[], k = 'line') {
  for (let i = 1; i < points.length; i++) p.seg(k, points[i - 1], points[i]);
}
function base(p: Part, w: number, d: number) {
  p.box(-w / 2, -d / 2, 0, w, d, 0.55, 'gr');
  p.rect2(TOP(0, 0, 0.56), -w / 2 + 1, -d / 2 + 1, w - 2, d - 2, 'detail', 0.02);
}
function podium(p: Part, w: number, d: number, h = 6) {
  base(p, w + 4, d + 4);
  p.box(-w / 2, -d / 2, 0.55, w, d, h);
  curtain(p, FRONT(-w / 2, d / 2, h + 0.55), w, h, { floor:3, bay:2.6, lit:0.22 });
  curtain(p, SIDE(w / 2, d / 2, h + 0.55), d, h, { floor:3, bay:2.6, lit:0.22 });
  p.rect2(TOP(0, 0, h + 0.55), -w / 2 + 0.5, -d / 2 + 0.5, w - 1, d - 1, 'line', 0.02);
}
function interpolate(stations: readonly (readonly [number, number])[], z: number) {
  for (let i = 1; i < stations.length; i++) {
    const [za, ra] = stations[i - 1], [zb, rb] = stations[i];
    if (z <= zb) return ra + (rb - ra) * (z - za) / (zb - za);
  }
  return stations.at(-1)![1];
}

/** 春笋：圆形外筒、收分轮廓、竖肋，以及顶部交错钢网。 */
function springBamboo() {
  const p = new Part();
  podium(p, 45, 34, 5.4);
  p.box(-24, 8, 5.9, 48, 10, 0.7).box(-9, 17, 3.5, 18, 4.6, 0.45, 'n');
  for (const x of [-7.8, 0, 7.8]) p.box(x - 0.22, 19, 0.55, 0.44, 0.44, 2.95);
  const stations = [[5.9, 10.6], [15, 12.2], [32, 14.5], [52, 13.8], [69, 11.7], [80, 8.9], [90, 5.7], [97, 2.7], [102, 0.4]] as const;
  const radius = (z: number) => interpolate(stations, z);
  const at = (a: number, z: number, lift = 0) => W(Math.cos(a) * (radius(z) + lift), Math.sin(a) * (radius(z) + lift), z);
  const ribs = 40;
  // 每个表面按层合并，玻璃与夜间窗片仍是原作的统一材质。
  for (let z = 5.9, floor = 0; z < 102; z += 2.8, floor++) {
    const z1 = Math.min(102, z + 2.8);
    for (let i = 0; i < ribs; i++) {
      const a = i / ribs * TAU, b = (i + 1) / ribs * TAU;
      p.poly('glass', [at(a, z), at(b, z), at(b, z1), at(a, z1)]);
      if (z < 82 && (i * 11 + floor * 7) % 13 < 3) {
        p.poly('window', [at(a + 0.035, z + 0.45, 0.025), at(b - 0.035, z + 0.45, 0.025), at(b - 0.035, z1 - 0.4, 0.025), at(a + 0.035, z1 - 0.4, 0.025)]);
      }
    }
    if (z < 84) outline(p, ring(0, 0, radius(z) + 0.035, radius(z) + 0.035, z), 'detail');
  }
  for (let i = 0; i < ribs; i++) {
    const a = i / ribs * TAU;
    lineStrip(p, stations.map(([z]) => at(a, z, 0.08)), i % 2 === 0 ? 'line' : 'detail');
  }
  // 顶部竖肋交错成笋尖。中段保留安静的竖向节奏。
  for (const direction of [-1, 1]) for (let i = 0; i < 20; i++) {
    const points = Array.from({ length:13 }, (_, j) => {
      const z = 72 + j * 2.5;
      return at(i / 20 * TAU + direction * (z - 72) * 0.027, z, 0.105);
    });
    lineStrip(p, points, 'line');
  }
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU;
    p.seg('line', at(a - 0.11, 6.1, 0.08), at(a, 16, 0.08)).seg('line', at(a + 0.11, 6.1, 0.08), at(a, 16, 0.08));
  }
  outline(p, ring(0, 0, 10.8, 10.8, 6.0));
  return p.build('春笋');
}

/** 平安金融中心：八角主塔、显露的角柱、层层收尖的冠部。 */
function pingan() {
  const p = new Part();
  podium(p, 38, 35, 7);
  const shape = [[-0.62, -1], [0.62, -1], [1, -0.62], [1, 0.62], [0.62, 1], [-0.62, 1], [-1, 0.62], [-1, -0.62]];
  const stations = [[7.55, 15.1], [24, 14.8], [79, 12.8], [106, 10.4], [120, 5.4], [134, 0.6]] as const;
  const r = (z: number) => interpolate(stations, z);
  const at = (i: number, z: number, lift = 0) => W(shape[i][0] * (r(z) + lift), shape[i][1] * (r(z) + lift), z);
  for (let z = 7.55, row = 0; z < 134; z += 3.1, row++) {
    const z1 = Math.min(134, z + 3.1);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      p.poly('glass', [at(i, z), at(j, z), at(j, z1), at(i, z1)]);
      if (z < 115) p.seg('detail', at(i, z, 0.04), at(j, z, 0.04));
      const bays = i % 2 ? 3 : 6;
      for (let b = 0; b < bays; b++) {
        const pa = at(i, z, 0.06), pb = at(j, z, 0.06), pc = at(j, z1, 0.06), pd = at(i, z1, 0.06);
        const u = b / bays;
        p.seg('detail', pa.clone().lerp(pb, u), pd.clone().lerp(pc, u));
        if (z < 106 && (row * 7 + b * 3 + i) % 17 < 4) {
          const a0 = pa.clone().lerp(pb, u + 0.08 / bays), b0 = pa.clone().lerp(pb, u + 0.86 / bays);
          const a1 = pd.clone().lerp(pc, u + 0.08 / bays), b1 = pd.clone().lerp(pc, u + 0.86 / bays);
          a0.y += 0.45; b0.y += 0.45; a1.y -= 0.4; b1.y -= 0.4;
          p.poly('window', [a0, b0, b1, a1]);
        }
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    for (let s = 1; s < stations.length; s++) {
      const a = at(i, stations[s - 1][0], 0.13), b = at(i, stations[s][0], 0.13);
      beam(p, [a.x, a.z, a.y], [b.x, b.z, b.y], s === stations.length - 1 ? 0.24 : 0.7, 'n');
    }
  }
  for (const z of [34, 69, 106]) outline(p, shape.map(([x, y]) => W(x * (r(z) + 0.16), y * (r(z) + 0.16), z)), 'line');
  p.box(-6, 18, 3.5, 12, 4.5, 0.55);
  return p.build('平安金融中心');
}

/** 市民中心：宽阔展翼屋顶下的方塔、圆塔和两侧低楼。 */
function civicCenter() {
  const p = new Part();
  base(p, 76, 43);
  for (const x of [-32, 14]) {
    p.box(x, -13, 0.55, 18, 26, 8.2);
    curtain(p, FRONT(x, 13, 8.75), 18, 8.2, { floor:2.6, bay:1.8, lit:0.32 });
    curtain(p, SIDE(x + 18, 13, 8.75), 26, 8.2, { floor:2.6, bay:1.8, lit:0.26 });
  }
  p.box(-11.7, -10, 0.55, 8.6, 15, 13.4, 'k');
  p.cylZ(7.8, -1.5, 0.55, 4.6, 13.4, 28, 'n');
  for (let z = 3; z < 13; z += 2.1) outline(p, ring(7.8, -1.5, 4.63, 4.63, z, 28), 'detail');
  p.box(-14, 6, 0.55, 28, 6, 5.2, 'g');
  curtain(p, FRONT(-14, 12, 5.75), 28, 5.2, { floor:2.6, bay:2, lit:0.35 });
  const roof = (x: number, y: number, dz = 0) => W(x, y, 13.8 + 4.4 * Math.sin(Math.abs(x / 36) * Math.PI * 0.68) + Math.cos(y / 19 * Math.PI / 2) * 0.8 + dz);
  for (let x = -36; x < 36; x += 2) {
    for (let y = -18; y < 18; y += 3) p.poly('deck', [roof(x, y), roof(x + 2, y), roof(x + 2, y + 3), roof(x, y + 3)]);
    for (const y of [-18, 18]) {
      p.poly('body', [roof(x, y), roof(x + 2, y), roof(x + 2, y, -0.65), roof(x, y, -0.65)]);
      p.seg('line', roof(x, y, 0.04), roof(x + 2, y, 0.04));
    }
    if (x % 4 === 0) lineStrip(p, Array.from({ length:13 }, (_, i) => roof(x, -18 + i * 3, 0.05)), 'detail');
  }
  for (const x of [-36, 36]) p.seg('line', roof(x, -18, 0.04), roof(x, 18, 0.04));
  for (const y of [-9, 0, 9]) lineStrip(p, Array.from({ length:37 }, (_, i) => roof(-36 + i * 2, y, 0.05)), 'detail');
  // 大屋顶的纤细支柱，避免变成封闭盒子。
  for (const x of [-29, -19, 19, 29]) for (const y of [-13, 13]) p.box(x - 0.22, y - 0.22, 8.75, 0.44, 0.44, roof(x, y).y - 9.4);
  for (let n = 0; n < 3; n++) p.box(-12 - n, 15 + n, 0, 24 + n * 2, 1.2, 0.5 - n * 0.13);
  return p.build('市民中心');
}

/** 京基一百：微凸幕墙与从宽面卷起的弧形冠部。 */
function kk100() {
  const p = new Part();
  podium(p, 40, 33, 5.5);
  const at = (a: number, t: number, lift = 0) => {
    const width = 13.6 * (1 - 0.12 * t + 0.085 * Math.sin(Math.PI * t));
    const depth = 9.9 * (1 - 0.15 * t);
    const crown = 105 + 11.5 * Math.sin((Math.cos(a) + 1) * Math.PI / 2);
    return W((width + lift) * Math.cos(a), (depth + lift) * Math.sin(a), 6.05 + t * (crown - 6.05));
  };
  const n = 40, floors = 37;
  for (let f = 0; f < floors; f++) for (let i = 0; i < n; i++) {
    const a = i / n * TAU, b = (i + 1) / n * TAU, t0 = f / floors, t1 = (f + 1) / floors;
    p.poly('glass', [at(a, t0), at(b, t0), at(b, t1), at(a, t1)]);
    p.seg('detail', at(a, t0, 0.035), at(b, t0, 0.035));
    if (f < 32 && (f * 5 + i * 3) % 19 < 4) p.poly('window', [at(a + 0.035, t0 + 0.005, 0.055), at(b - 0.035, t0 + 0.005, 0.055), at(b - 0.035, t1 - 0.004, 0.055), at(a + 0.035, t1 - 0.004, 0.055)]);
  }
  for (let i = 0; i < n; i++) lineStrip(p, Array.from({ length:15 }, (_, j) => at(i / n * TAU, j / 14, 0.075)), i % 5 === 0 ? 'line' : 'detail');
  const crown = Array.from({ length:n }, (_, i) => at(i / n * TAU, 1));
  // 每片顶面连向抬高的中脊，保留从东西两端卷起的冠部轮廓。
  const ridge = W(0, 0, 118);
  for (let i = 0; i < n; i++) p.tri('deck', crown[i], crown[(i + 1) % n], ridge);
  outline(p, crown);
  for (let i = 0; i < n; i += 4) p.seg('detail', crown[i], ridge);
  p.box(-7.5, 17, 4, 15, 4.8, 0.7);
  return p.build('京基一百');
}

/** 春茧：连续椭圆壳体、开口球场、细密交叉屋架。 */
function cocoon() {
  const p = new Part();
  base(p, 90, 53);
  function shell(cx: number, cy: number, rx: number, ry: number, h: number, open: boolean) {
    const n = 48, rows = 12, end = open ? 1.06 : Math.PI / 2;
    const at = (a: number, t: number, lift = 0) => W(cx + rx * Math.cos(t) * Math.cos(a), cy + ry * Math.cos(t) * Math.sin(a), 2.8 + h * Math.sin(t) + lift);
    for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
      const a = i / n * TAU, b = (i + 1) / n * TAU, t0 = j / rows * end, t1 = (j + 1) / rows * end;
      p.poly('deck', [at(a, t0), at(b, t0), at(b, t1), at(a, t1)]);
      // 主屋架略稀，交叉细线保留原作手绘工程模型的密度。
      p.seg('detail', at(a, t0, 0.04), at(b, t1, 0.04));
      if ((i + j) % 2 === 0) p.seg('detail', at(b, t0, 0.055), at(a, t1, 0.055));
    }
    for (let i = 0; i < n; i += 3) lineStrip(p, Array.from({ length:rows + 1 }, (_, j) => at(i / n * TAU, j / rows * end, 0.08)), 'line');
    for (const t of [0, end]) outline(p, Array.from({ length:n }, (_, i) => at(i / n * TAU, t, 0.05)));
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * TAU, x = cx + Math.cos(a) * rx * 0.95, y = cy + Math.sin(a) * ry * 0.95;
      p.box(x - 0.2, y - 0.2, 0.55, 0.4, 0.4, 2.25);
    }
    if (open) {
      const inX = rx * Math.cos(end), inY = ry * Math.cos(end), rimZ = 2.8 + h * Math.sin(end);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, b = (i + 1) / n * TAU;
        p.poly('body', [W(cx + inX * Math.cos(a), cy + inY * Math.sin(a), rimZ), W(cx + inX * Math.cos(b), cy + inY * Math.sin(b), rimZ), W(cx + inX * 0.9 * Math.cos(b), cy + inY * 0.9 * Math.sin(b), rimZ - 2), W(cx + inX * 0.9 * Math.cos(a), cy + inY * 0.9 * Math.sin(a), rimZ - 2)]);
      }
      p.poly('grass', ring(cx, cy, inX * 0.9, inY * 0.9, 3.0));
      p.rect2(TOP(cx, cy, 3.01), -8, -5, 16, 10, 'line', 0.03).draw(TOP(cx, cy, 3.01), [0, -5, 0, 5], 'detail', 0.03);
    }
  }
  shell(-15.5, 0, 28, 23, 15.5, true);
  shell(24, -0.5, 18, 19, 11.5, false);
  p.box(-43, 19, 0.55, 86, 3, 0.4, 'gr');
  for (let x = -38; x < 42; x += 8) p.box(x, 23, 0.55, 3.5, 1, 0.5);
  return p.build('深圳湾体育中心');
}

/** 深圳湾大桥：只保留主跨、斜拉索与桥塔，模型长度经过压缩。 */
function bayBridge() {
  const p = new Part();
  const length = 192, deckZ = 7;
  p.box(-length / 2, -6, deckZ, length, 12, 1.05, 'gr');
  for (const y of [-6, 6]) {
    p.box(-length / 2, y - 0.15, deckZ + 1.05, length, 0.3, 0.45, 'n');
    p.seg('line', W(-length / 2, y, deckZ + 2), W(length / 2, y, deckZ + 2));
    for (let x = -length / 2; x <= length / 2; x += 4) p.seg('detail', W(x, y, deckZ + 1.4), W(x, y, deckZ + 2));
  }
  for (let x = -92; x < 94; x += 7) p.seg('detail', W(x, 0, deckZ + 1.09), W(x + 3.7, 0, deckZ + 1.09));
  for (const tx of [-43, 43]) {
    p.box(tx - 3.6, -4.3, 0, 7.2, 8.6, deckZ, 'n');
    for (const y of [-4.8, 4.8]) beam(p, [tx, y, deckZ + 1.2], [tx + Math.sign(tx) * 4, y * 0.27, 46], 1.45, 'n', 1.8);
    p.box(tx + Math.sign(tx) * 4 - 1.15, -1.65, 45.2, 2.3, 3.3, 2.2);
    for (const side of [-1, 1]) for (let j = 1; j <= 8; j++) {
      const dx = j * 5.7 * side, z = 44.8 - j * 1.2;
      for (const y of [-4.6, 4.6]) p.seg('line', W(tx + Math.sign(tx) * 4, y * 0.28, z), W(tx + dx, y, deckZ + 1.3));
    }
  }
  for (const x of [-86, 0, 86]) p.box(x - 1.7, -3.7, 0, 3.4, 7.4, deckZ, 'n');
  const group = p.build('深圳湾大桥');
  group.userData.contextOnly = true; // 地标桥不表示骑行线路可上桥。
  return group;
}

/** 港吊模型完整复用原 Factory，设置原有活动部件的静止姿态。 */
function portCrane() {
  const crane = buildSTS('盐田港'), yc = (PORT.rails[0] + PORT.rails[1]) / 2;
  const trolleyY = PORT.rails[1] + 12, spreaderZ = PORT.z + 6;
  crane.trolley.position.copy(W(0, trolleyY, STS.trolleyZ));
  crane.spreader.position.copy(W(0, trolleyY, spreaderZ));
  crane.ropes.position.copy(W(0, trolleyY, spreaderZ + 1));
  crane.ropes.scale.y = STS.trolleyZ - spreaderZ - 1;
  crane.stays.add(staysPart(0));
  crane.g.position.copy(W(0, -yc, -PORT.z));
  const group = new THREE.Group(); group.name = '盐田港岸桥'; group.add(crane.g);
  group.userData.crane = { boom:crane.boom, trolley:crane.trolley, spreader:crane.spreader, ropes:crane.ropes };
  return group;
}

/** 海滨观景塔是区域识别模型，不作为建筑测绘模型。 */
function beachTower() {
  const p = new Part();
  p.cylZ(0, 0, 0, 6, 0.6, 24).cylZ(0, 0, 0.6, 2.4, 25.6, 16, 'n');
  for (let j = 0; j < 50; j++) {
    const a = j * 0.31, b = (j + 1) * 0.31, z = 1.6 + j * 0.48;
    p.seg('detail', W(Math.cos(a) * 2.55, Math.sin(a) * 2.55, z), W(Math.cos(b) * 2.55, Math.sin(b) * 2.55, z + 0.48));
  }
  p.cylZ(0, 0, 25.5, 5.3, 0.8, 24).cylZ(0, 0, 26.3, 3.7, 3.8, 24, 'w').cylZ(0, 0, 30.1, 5.5, 0.65, 24, 'n');
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    p.seg('line', W(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 26.3), W(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 30.1));
  }
  p.cylZ(0, 0, 30.75, 1.4, 2.3, 12, 'n').box(-0.15, -0.15, 33.05, 0.3, 0.3, 2.7, 'k');
  return p.build('海滨观景塔');
}

const BUILDERS: Record<LandmarkKind, () => THREE.Group> = {
  'spring-bamboo':springBamboo, pingan, 'civic-center':civicCenter, kk100,
  cocoon, 'bay-bridge':bayBridge, 'port-crane':portCrane, 'beach-tower':beachTower,
};

export function buildLandmark(kind: string): THREE.Group {
  if (!Object.hasOwn(BUILDERS, kind)) throw new Error(`未知地标模型：${kind}`);
  const group = BUILDERS[kind as LandmarkKind]();
  group.userData.landmarkKind = kind;
  group.userData.modelScale = '微缩示意';
  return group;
}

/** 公路车骑手：原作人物上身，加弯把车与固定骑姿，朝向 +x。 */
export function buildCyclist(): THREE.Group {
  const p = new Part(), person = buildPerson('walker', 0, false);
  const lean = new THREE.Matrix4().makeTranslation(-0.22, 0.89, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(-0.58))
    .multiply(new THREE.Matrix4().makeTranslation(0, -0.86, 0));
  // 只收原人物的上身、头和发型。四肢由骑姿决定，按原材质合并为四组。
  for (const child of person.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.userData.fill && mesh.geometry?.attributes.position) {
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 3) p.tri(mesh.userData.fill,
        new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(lean),
        new THREE.Vector3().fromBufferAttribute(positions, i + 1).applyMatrix4(lean),
        new THREE.Vector3().fromBufferAttribute(positions, i + 2).applyMatrix4(lean));
    } else if (mesh.userData.line && mesh.geometry?.attributes.instanceStart) {
      const start = mesh.geometry.attributes.instanceStart, end = mesh.geometry.attributes.instanceEnd;
      for (let i = 0; i < start.count; i++) p.seg(mesh.userData.line,
        new THREE.Vector3().fromBufferAttribute(start, i).applyMatrix4(lean),
        new THREE.Vector3().fromBufferAttribute(end, i).applyMatrix4(lean));
    }
  }
  // 上身已合并，释放原人物临时几何；原共享材质仍归场景管理。
  person.traverse((object: THREE.Object3D) => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); });
  for (const x of [-0.59, 0.59]) for (let i = 0; i < 32; i++) {
    const a = i / 32 * TAU, b = (i + 1) / 32 * TAU;
    for (const y of [-0.025, 0.025]) p.poly('kob', [
      W(x + Math.cos(a) * 0.35, y, 0.35 + Math.sin(a) * 0.35),
      W(x + Math.cos(b) * 0.35, y, 0.35 + Math.sin(b) * 0.35),
      W(x + Math.cos(b) * 0.315, y, 0.35 + Math.sin(b) * 0.315),
      W(x + Math.cos(a) * 0.315, y, 0.35 + Math.sin(a) * 0.315)]);
    p.seg('koline', W(x + Math.cos(a) * 0.35, 0, 0.35 + Math.sin(a) * 0.35), W(x + Math.cos(b) * 0.35, 0, 0.35 + Math.sin(b) * 0.35));
    if (i % 4 === 0) p.seg('koline', W(x, 0, 0.35), W(x + Math.cos(a) * 0.315, 0, 0.35 + Math.sin(a) * 0.315));
  }
  const axleBack = [-0.59, 0, 0.35], crank = [-0.06, 0, 0.37], seat = [-0.24, 0, 0.89], head = [0.43, 0, 0.88];
  for (const [a, b] of [[axleBack, crank], [axleBack, seat], [crank, seat], [seat, head], [crank, head], [head, [0.59, 0, 0.35]]]) beam(p, a, b, 0.045, 'kb');
  beam(p, seat, [-0.24, 0, 0.97], 0.055, 'kb');
  p.box(-0.4, -0.11, 0.96, 0.3, 0.22, 0.045, 'kb');
  beam(p, head, [0.48, 0, 1.045], 0.05, 'kb');
  beam(p, [0.48, 0, 1.045], [0.58, 0, 1.045], 0.045, 'kb');
  beam(p, [0.58, -0.24, 1.045], [0.58, 0.24, 1.045], 0.042, 'kb');
  for (const y of [-0.24, 0.24]) lineStrip(p, [W(0.58, y, 1.045), W(0.68, y, 1), W(0.67, y, 0.91), W(0.55, y, 0.87)], 'koline');
  for (const side of [-1, 1]) {
    const y = side * 0.12, pedal = side > 0 ? 0.24 : 0.51, kneeX = side > 0 ? 0.05 : 0.17;
    beam(p, [-0.22, y, 0.9], [kneeX, y, 0.66], 0.12, 'kb');
    beam(p, [kneeX, y, 0.66], [-0.06, y, pedal], 0.09, 'nb');
    p.box(-0.14, y - 0.055, pedal - 0.025, 0.22, 0.11, 0.065, 'kb');
    beam(p, [-0.06, y, pedal], [-0.06, 0, 0.37], 0.035, 'kb');
    const shoulder = W(0, side * 0.22, 1.38).applyMatrix4(lean);
    beam(p, [shoulder.x, shoulder.z, shoulder.y], [0.43, side * 0.23, 1.12], 0.09, 'nb');
    beam(p, [0.43, side * 0.23, 1.12], [0.58, side * 0.24, 1.03], 0.07, 'nb');
  }
  // 头盔跟随原作头部的俯身姿态。
  const helmet = new THREE.Matrix4().copy(lean).multiply(new THREE.Matrix4().makeTranslation(0, 1.72, 0));
  p.geo(new THREE.SphereGeometry(0.14, 10, 5), helmet.multiply(new THREE.Matrix4().makeScale(1.25, 0.68, 1)), 'kb');
  const group = p.build('公路车骑手');
  group.userData.forward = '+x';
  return group;
}
