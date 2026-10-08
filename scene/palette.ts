import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { FILL, LINE, applyTheme, shade, css } from './factory/theme';

/** 原作 theme.ts 原样保留；此层只将地图命名映射到原作材质。 */
export type Tone = 'background' | 'ground' | 'road' | 'body' | 'deck' | 'glass' | 'sea' | 'grass' | 'line' | 'detail' | 'live' | 'ink' | 'window' | 'fog';
const ease = (t: number) => t * t * (3 - 2 * t);
export const nightAmount = (hour: number) => hour < 5 ? 1 : hour < 7 ? 1 - ease((hour - 5) / 2) : hour < 18.5 ? 0 : hour < 20.5 ? ease((hour - 18.5) / 2) : 1;
const fills = FILL as Record<string, THREE.MeshBasicMaterial>;
const lines = LINE as Record<string, LineMaterial>;
const TONES: Tone[] = ['background', 'ground', 'road', 'body', 'deck', 'glass', 'sea', 'grass', 'line', 'detail', 'live', 'ink', 'window', 'fog'];
export class Palette {
  private extraLines = new Map<string, LineMaterial>();
  private extraFaces = new Map<Tone, THREE.MeshBasicMaterial>();
  private currentTheme = '';
  readonly colors = Object.fromEntries(TONES.map(key => [key, new THREE.Color()])) as Record<Tone, THREE.Color>;
  width = 1; height = 1;
  constructor() { applyTheme(); }
  face(tone: Tone): THREE.MeshBasicMaterial {
    if (fills[tone === 'live' ? 'livef' : tone]) return fills[tone === 'live' ? 'livef' : tone];
    if (!this.extraFaces.has(tone)) this.extraFaces.set(tone, new THREE.MeshBasicMaterial({ color: this.colors[tone], side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    return this.extraFaces.get(tone)!;
  }
  line(tone: Tone, width = 1) {
    if (width === 1 && lines[tone]) return lines[tone];
    const key = `${tone}:${width}`;
    if (!this.extraLines.has(key)) {
      const material = lines[tone in lines ? tone : 'detail'].clone();
      material.linewidth = width; material.resolution.set(this.width, this.height);
      this.extraLines.set(key, material);
    }
    return this.extraLines.get(key)!;
  }
  resize(width: number, height: number) {
    this.width = width; this.height = height;
    for (const material of [...Object.values(lines), ...this.extraLines.values()]) material.resolution.set(width, height);
  }
  update(theme: 'light' | 'dark', hour: number, rain: number, fog: number) {
    if (this.currentTheme !== theme) { applyTheme(); this.currentTheme = theme; }
    // 原作 view.ts 的天气压暗与昼夜混合表达式。
    const amount = Math.max(nightAmount(hour), .32 * rain + .15 * fog);
    shade(amount, false);
    for (const tone of TONES) {
      const material = fills[tone === 'live' ? 'livef' : tone] || lines[tone];
      if (material) this.colors[tone].copy(material.color);
    }
    this.colors.background.set(css('--panel')).lerp(fills.ground.color, amount);
    this.colors.fog.copy(this.colors.background);
    this.colors.ink.set(css('--ink')).lerp(this.colors.line, amount * .5);
    for (const [key, material] of this.extraLines) material.color.copy(this.colors[key.split(':')[0] as Tone]);
    for (const [tone, material] of this.extraFaces) material.color.copy(this.colors[tone]);
  }
  dispose() {
    this.extraFaces.forEach(material => material.dispose());
    this.extraLines.forEach(material => material.dispose());
  }
}
