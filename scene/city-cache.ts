import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { FILL, LINE } from './factory/theme';

interface CachedNode {
  name: string;
  transform: number[];
  visible: boolean;
  kind: 'group' | 'fill' | 'line';
  tone: string;
  offset: number;
  count: number;
  children: CachedNode[];
}
const MAGIC = 0x31474353;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function nodeValue(value: unknown, floats: number): value is CachedNode {
  return record(value) && typeof value.name === 'string' && Array.isArray(value.transform) && value.transform.length === 10 && value.transform.every(finite)
    && typeof value.visible === 'boolean' && ['group', 'fill', 'line'].includes(String(value.kind)) && typeof value.tone === 'string'
    && finite(value.offset) && Number.isInteger(value.offset) && value.offset >= 0 && finite(value.count) && Number.isInteger(value.count) && value.count >= 0 && value.offset + value.count <= floats
    && value.count % (value.kind === 'line' ? 6 : 3) === 0 && Array.isArray(value.children) && value.children.every(child => nodeValue(child, floats));
}

/** Float32来源缓冲直接恢复原始三角面与线段，不进行挤出或三角化。 */
export function decodeCityCache(buffer: ArrayBuffer): Map<string, THREE.Group> {
  if (buffer.byteLength < 12) throw new Error('街区缓存不完整');
  const header = new DataView(buffer), size = header.getUint32(4, true), payload = Math.ceil((8 + size) / 4) * 4;
  if (header.getUint32(0, true) !== MAGIC || payload > buffer.byteLength || (buffer.byteLength - payload) % 4) throw new Error('街区缓存格式不正确');
  const data: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, size)));
  const floatCount = (buffer.byteLength - payload) / 4;
  if (!record(data) || data.version !== 1 || !record(data.groups)) throw new Error('街区缓存索引不完整');
  const result = new Map<string, THREE.Group>();
  const restore = (node: CachedNode): THREE.Object3D => {
    let object: THREE.Object3D;
    if (node.kind === 'group') object = new THREE.Group();
    else {
      const positions = new Float32Array(buffer, payload + node.offset * 4, node.count);
      if (node.kind === 'line') {
        const material: unknown = Reflect.get(LINE, node.tone);
        if (!(material instanceof LineMaterial)) throw new Error('街区线条材质未注册');
        object = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material);
        object.userData.line = node.tone; object.raycast = () => {};
      } else {
        const material: unknown = Reflect.get(FILL, node.tone);
        if (!(material instanceof THREE.MeshBasicMaterial)) throw new Error('街区表面材质未注册');
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        object = new THREE.Mesh(geometry, material); object.userData.fill = node.tone;
      }
    }
    object.name = node.name; object.visible = node.visible;
    object.position.fromArray(node.transform, 0); object.quaternion.fromArray(node.transform, 3); object.scale.fromArray(node.transform, 7);
    for (const child of node.children) object.add(restore(child));
    return object;
  };
  try {
    for (const [key, value] of Object.entries(data.groups)) {
      if (!nodeValue(value, floatCount) || value.kind !== 'group') throw new Error('街区几何索引不正确');
      const group = restore(value); if (!(group instanceof THREE.Group)) throw new Error('街区分组不正确');
      result.set(key, group);
    }
    return result;
  } catch (error) {
    for (const group of result.values()) group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
}

export async function fetchCityCache(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('街区缓存尚未载入');
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  return { groups: decodeCityCache(buffer), bytes: buffer.byteLength };
}
