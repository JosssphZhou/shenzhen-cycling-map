// @ts-nocheck
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { FILL, LINE } from '../theme';
import { noop } from '../shared';

// What the weather looks like. Rain is short slanted hairlines in a box that follows the view and is sized to it, so
// the streaks are about the same length on screen at any zoom; two copies of the box stacked one above the other
// fall together and wrap. Fog is a few translucent sheets over the sea and the coast, thinner inland, drifting.
const lcg = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(7);   // looks only: the town's own random numbers are left alone
export function buildRain() {
  const N = 1100, pos = [];
  for (let i = 0; i < N; i++) { const x = lcg() - 0.5, z = lcg() - 0.5, y = lcg(); pos.push(x, y, z, x + 0.0035, y - 0.028, z + 0.0025); }
  const g = new THREE.Group(); g.name = 'rain'; g.visible = false;
  const layers = [0, 1].map(() => { const l = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), LINE.detail); l.frustumCulled = false; l.raycast = noop; g.add(l); return l; });
  let f = 0;
  return { group:g, update(dt, target, extent, amount) {
    g.visible = amount > 0.02; if (!g.visible) return;
    const S = extent * 1.6, H = extent * 0.3;
    g.position.set(target.x, 0, target.z); g.scale.set(S, H, S);
    f = (f + dt * 1.1) % 1; layers[0].position.y = -f; layers[1].position.y = 1 - f;
    for (const l of layers) l.geometry.instanceCount = Math.floor(N * amount);
  } };
}
