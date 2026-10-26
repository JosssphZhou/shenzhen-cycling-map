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
const PACKED_MAGIC = 0x32474353;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function nodeValue(value: unknown, floats: number): value is CachedNode {
  return record(value) && typeof value.name === 'string' && Array.isArray(value.transform) && value.transform.length === 10 && value.transform.every(finite)
    && typeof value.visible === 'boolean' && ['group', 'fill', 'line'].includes(String(value.kind)) && typeof value.tone === 'string'
    && finite(value.offset) && Number.isInteger(value.offset) && value.offset >= 0 && finite(value.count) && Number.isInteger(value.count) && value.count >= 0 && value.offset + value.count <= floats
    && value.count % (value.kind === 'line' ? 6 : 3) === 0 && Array.isArray(value.children) && value.children.every(child => nodeValue(child, floats));
}
function restoreWords(data: Record<string, unknown>, buffer: ArrayBuffer, payload: number) {
  if (!finite(data.floatCount) || !Number.isInteger(data.floatCount) || data.floatCount < 0 || data.floatCount % 3 || data.floatCount > 50000000
    || !finite(data.vertexCount) || !Number.isInteger(data.vertexCount) || data.vertexCount < 0 || data.vertexCount * 3 > data.floatCount) throw new Error('街区压缩索引不正确');
  const bytes = new Uint8Array(buffer, payload); let cursor = 0;
  const uint = () => {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = bytes[cursor++];
      if (byte === undefined || shift === 28 && byte > 15) throw new Error('街区压缩索引不完整');
      value |= (byte & 127) << shift;
      if (!(byte & 128)) return value >>> 0;
    }
    throw new Error('街区压缩索引超出范围');
  };
  let vertices: Uint32Array;
  if (data.codec === 'tuple32') {
    const size = data.vertexCount * 12;
    if (size > bytes.byteLength) throw new Error('街区顶点字典不完整');
    vertices = new Uint32Array(buffer, payload, data.vertexCount * 3); cursor = size;
  } else if (data.codec === 'tuple-scalar32') {
    if (!finite(data.scalarCount) || !Number.isInteger(data.scalarCount) || data.scalarCount < 0 || data.scalarCount > data.vertexCount * 3) throw new Error('街区坐标字典不正确');
    const scalars = new Uint32Array(data.scalarCount); let previous = 0;
    for (let index = 0; index < scalars.length; index++) { previous += uint(); if (previous > 0xffffffff) throw new Error('街区坐标位模式不正确'); scalars[index] = previous; }
    vertices = new Uint32Array(data.vertexCount * 3);
    for (let index = 0; index < vertices.length; index++) { const scalar = uint(); if (scalar >= scalars.length) throw new Error('街区坐标字典越界'); vertices[index] = scalars[scalar]; }
  } else throw new Error('未知街区压缩格式');
  const result = new Uint32Array(data.floatCount); let previousVertex = 0;
  for (let index = 0; index < result.length; index += 3) {
    const value = uint(), delta = (value >>> 1) ^ -(value & 1); previousVertex += delta;
    if (previousVertex < 0 || previousVertex >= data.vertexCount) throw new Error('街区顶点索引越界');
    const vertex = previousVertex * 3;
    result[index] = vertices[vertex]; result[index + 1] = vertices[vertex + 1]; result[index + 2] = vertices[vertex + 2];
  }
  if (cursor !== bytes.length) throw new Error('街区压缩数据长度不正确');
  return result;
}

/** Float32来源缓冲直接恢复原始三角面与线段，不进行挤出或三角化。 */
export function decodeCityCache(buffer: ArrayBuffer): Map<string, THREE.Group> {
  if (buffer.byteLength < 12) throw new Error('街区缓存不完整');
  const header = new DataView(buffer), magic = header.getUint32(0, true), size = header.getUint32(4, true), payload = Math.ceil((8 + size) / 4) * 4;
  if (![MAGIC, PACKED_MAGIC].includes(magic) || payload > buffer.byteLength || magic === MAGIC && (buffer.byteLength - payload) % 4) throw new Error('街区缓存格式不正确');
  const data: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, size)));
  if (!record(data) || data.version !== (magic === MAGIC ? 1 : 2) || !record(data.groups)) throw new Error('街区缓存索引不完整');
  const restored = magic === PACKED_MAGIC ? restoreWords(data, buffer, payload) : null;
  const floatCount = restored ? restored.length : (buffer.byteLength - payload) / 4;
  const geometryBuffer = restored ? restored.buffer : buffer, geometryOffset = restored ? 0 : payload;
  const result = new Map<string, THREE.Group>();
  const restore = (node: CachedNode): THREE.Object3D => {
    let object: THREE.Object3D;
    if (node.kind === 'group') object = new THREE.Group();
    else {
      const positions = new Float32Array(geometryBuffer, geometryOffset + node.offset * 4, node.count);
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
