import { gzipSync } from 'node:zlib';

export function encodeCityCacheV1(groups) {
  const arrays = []; let cursor = 0;
  const visit = object => {
    let kind = 'group', tone = '', array = null;
    if (object.userData.line) { kind = 'line'; tone = object.userData.line; array = object.geometry.attributes.instanceStart.data.array; }
    else if (object.userData.fill) { kind = 'fill'; tone = object.userData.fill; array = object.geometry.attributes.position.array; }
    const node = { name: object.name, transform: [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()], visible: object.visible, kind, tone, offset: cursor, count: array?.length || 0, children: [] };
    if (array) { arrays.push(array); cursor += array.length; }
    node.children = object.children.map(visit); return node;
  };
  const metadata = Buffer.from(JSON.stringify({ version: 1, groups: Object.fromEntries([...groups].map(([key, group]) => [key, visit(group)])) }));
  const offset = Math.ceil((8 + metadata.length) / 4) * 4, buffer = Buffer.alloc(offset + cursor * 4);
  buffer.writeUInt32LE(0x31474353, 0); buffer.writeUInt32LE(metadata.length, 4); metadata.copy(buffer, 8);
  const floats = new Float32Array(buffer.buffer, buffer.byteOffset + offset, cursor);
  let index = 0; for (const array of arrays) { floats.set(array, index); index += array.length; }
  return buffer;
}
function varints(values) {
  const bytes = Buffer.alloc(values.length * 5); let at = 0;
  for (let value of values) { while (value > 127) { bytes[at++] = (value & 127) | 128; value >>>= 7; } bytes[at++] = value; }
  return bytes.subarray(0, at);
}
function wrap(metadata, payload) {
  const json = Buffer.from(JSON.stringify(metadata)), offset = Math.ceil((8 + json.length) / 4) * 4;
  const buffer = Buffer.alloc(offset + payload.length); buffer.writeUInt32LE(0x32474353, 0); buffer.writeUInt32LE(json.length, 4); json.copy(buffer, 8); payload.copy(buffer, offset); return buffer;
}

/** 字典存储Uint32位模式，索引保持原顶点顺序；小文件无收益时仍保留V1。 */
export function packCityCache(raw) {
  const jsonSize = raw.readUInt32LE(4), offset = Math.ceil((8 + jsonSize) / 4) * 4;
  const metadata = JSON.parse(raw.subarray(8, 8 + jsonSize).toString());
  const words = new Uint32Array(raw.buffer, raw.byteOffset + offset, (raw.length - offset) / 4);
  const vertices = [], dictionary = new Map(), indices = new Uint32Array(words.length / 3);
  for (let index = 0; index < words.length; index += 3) {
    const key = `${words[index]},${words[index + 1]},${words[index + 2]}`;
    let vertex = dictionary.get(key);
    if (vertex === undefined) { vertex = vertices.length / 3; dictionary.set(key, vertex); vertices.push(words[index], words[index + 1], words[index + 2]); }
    indices[index / 3] = vertex;
  }
  let previous = 0;
  for (let index = 0; index < indices.length; index++) { const value = indices[index], delta = (value - previous) | 0; previous = value; indices[index] = ((delta << 1) ^ (delta >> 31)) >>> 0; }
  const isBase = Object.keys(metadata.groups).some(key => key.startsWith('base/'));
  let packed;
  if (isBase) {
    const scalars = [...new Set(vertices)].sort((a, b) => a - b), scalarIds = new Map(scalars.map((value, index) => [value, index]));
    const scalarDeltas = scalars.map((value, index) => index ? value - scalars[index - 1] : value);
    const vertexValues = vertices.map(value => scalarIds.get(value));
    packed = wrap({ version: 2, groups: metadata.groups, codec: 'tuple-scalar32', floatCount: words.length, vertexCount: vertices.length / 3, scalarCount: scalars.length }, Buffer.concat([varints(scalarDeltas), varints(vertexValues), varints(indices)]));
  } else {
    packed = wrap({ version: 2, groups: metadata.groups, codec: 'tuple32', floatCount: words.length, vertexCount: vertices.length / 3 }, Buffer.concat([Buffer.from(new Uint32Array(vertices).buffer), varints(indices)]));
  }
  return gzipSync(packed, { level: 6 }).length < gzipSync(raw, { level: 6 }).length * .98 ? packed : raw;
}
