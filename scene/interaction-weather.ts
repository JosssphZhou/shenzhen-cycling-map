import * as THREE from 'three';
import { FILL } from './factory/theme';
import { rand, rng } from './factory/kernel/math';
import type { Bounds } from './entities';

// Factory yard/sim/weather.ts 的自动天气状态机；仅模拟时钟由实例提供，文案改为中文。
export class CityWeather {
  kind: 'clear' | 'rain' | 'fog' = 'clear';
  look: 'clear' | 'rain' | 'fog' = 'clear';
  amount = 0; next = 90; until = 0; fogArmed = false; showers = 0;
  update(dt: number, t: number, hour: number) {
    if (hour < 4.5 || hour > 12) this.fogArmed = true;
    else if (this.fogArmed && hour < 5.5) { this.fogArmed = false; if (this.kind === 'clear' && rng() < .45) this.set('fog', rand(45, 70), t); }
    if (this.kind === 'clear' && (this.next -= dt) <= 0) { if (rng() < .4) this.set('rain', rand(40, 90), t); this.next = rand(90, 200); }
    if (this.kind !== 'clear' && t >= this.until) this.kind = 'clear';
    this.amount += Math.max(-dt / 8, Math.min(dt / 8, (this.kind === 'clear' ? 0 : 1) - this.amount));
    if (this.amount <= 0) this.look = this.kind;
  }
  set(kind: 'rain' | 'fog', seconds: number, t: number) { this.kind = kind; this.until = t + seconds; this.look = kind; if (kind === 'rain') this.showers++; }
  rain() { return this.look === 'rain' ? this.amount : 0; }
  fog() { return this.look === 'fog' ? this.amount : 0; }
  word() { return this.amount < .2 ? '' : this.look === 'rain' ? (this.amount > .7 ? '雨' : '阵雨') : this.look === 'fog' ? '雾' : ''; }
}

// Factory yard/world/weatherfx.ts 的五层海雾，边界取自深圳真实地理。
export function buildCityFog(bounds: Bounds) {
  const group = new THREE.Group(); group.name = 'fog'; group.visible = false;
  const Y1 = bounds[3] + 24, CX = (bounds[0] + bounds[1]) / 2, SPAN = bounds[1] - bounds[0] + 120;
  const south = (fraction: number) => bounds[2] + (bounds[3] - bounds[2]) * fraction;
  const sheets = [[south(.72), Y1, .5, 1], [south(.74), Y1, 2, .9], [south(.76), Y1, 4.2, .7], [south(.55), Y1, 1.2, .5], [south(.1), Y1, .8, .3]].map(([y0, y1, z, k]) => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, y1 - y0).rotateX(-Math.PI / 2), material);
    mesh.position.set(CX, z, (y0 + y1) / 2); mesh.raycast = () => {}; mesh.renderOrder = 2; group.add(mesh);
    return { mesh, material, k };
  });
  return { group, update(t: number, amount: number) {
    group.visible = amount > .02; if (!group.visible) return;
    sheets.forEach((sheet, i) => { sheet.material.color.copy((FILL as Record<string, THREE.MeshBasicMaterial>).deck.color); sheet.material.opacity = .32 * sheet.k * amount; sheet.mesh.position.x = CX + Math.sin(t * .05 + i * 1.7) * 30; });
  }, dispose() { sheets.forEach(sheet => sheet.material.dispose()); } };
}
