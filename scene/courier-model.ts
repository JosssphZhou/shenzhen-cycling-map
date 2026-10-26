import * as THREE from 'three';
import { Part } from './factory/kernel/part';
import { W } from './factory/kernel/iso';

export type CourierBrand = 'meituan' | 'eleme';
type Point = [number, number, number];
const BRAND = {
  meituan: { label: '美团外卖', color: '#ffd334', top: '#ffe57b', ink: '#202320' },
  eleme: { label: '饿了么', color: '#1297ed', top: '#65c1ff', ink: '#ffffff' },
} satisfies Record<CourierBrand, { label: string; color: string; top: string; ink: string }>;

/** 微缩电动踏板车，+x为前方；品牌材质和文字纹理只属于此模型。 */
export function buildCourierModel(initialBrand: CourierBrand = 'meituan') {
  const group = new THREE.Group();
  group.userData.forward = '+x';
  const materials = {
    shell: new THREE.MeshBasicMaterial({ color: '#4d5558', side: THREE.DoubleSide }),
    shellTop: new THREE.MeshBasicMaterial({ color: '#6a7477', side: THREE.DoubleSide }),
    black: new THREE.MeshBasicMaterial({ color: '#24282b', side: THREE.DoubleSide }),
    blackTop: new THREE.MeshBasicMaterial({ color: '#3c4246', side: THREE.DoubleSide }),
    metal: new THREE.MeshBasicMaterial({ color: '#a4afb1', side: THREE.DoubleSide }),
    metalTop: new THREE.MeshBasicMaterial({ color: '#d4dbdb', side: THREE.DoubleSide }),
    skin: new THREE.MeshBasicMaterial({ color: '#d6b99c', side: THREE.DoubleSide }),
    skinTop: new THREE.MeshBasicMaterial({ color: '#ead5bd', side: THREE.DoubleSide }),
    brand: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    brandTop: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    reflective: new THREE.MeshBasicMaterial({ color: '#ecf0dc', side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: '#fff3cc', side: THREE.DoubleSide }),
    tail: new THREE.MeshBasicMaterial({ color: '#df5541', side: THREE.DoubleSide }),
  };
  const ownGeometry = new Set<THREE.BufferGeometry>();
  const add = (part: Part, name: string, body: THREE.MeshBasicMaterial, deck = body) => {
    const built = part.build(name);
    built.traverse((object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) return;
      ownGeometry.add(object.geometry);
      if (object.userData.fill) object.material = object.userData.fill === 'deck' || object.userData.fill === 'kod' ? deck : body;
    });
    group.add(built);
  };
  const beam = (part: Part, from: Point, to: Point, diameter: number) => {
    const a = W(...from), b = W(...to), delta = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(diameter / 2, diameter / 2, delta.length(), 8);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    part.geo(geometry, new THREE.Matrix4().compose(a.add(b).multiplyScalar(.5), rotation, new THREE.Vector3(1, 1, 1)), 'n');
    geometry.dispose();
  };
  const sphere = (part: Part, center: Point, radius: number, scale: Point = [1, 1, 1]) => {
    const geometry = new THREE.SphereGeometry(radius, 10, 6);
    part.geo(geometry, new THREE.Matrix4().compose(W(...center), new THREE.Quaternion(), new THREE.Vector3(...scale)), 'n');
    geometry.dispose();
  };

  const shell = new Part();
  shell.box(-.58, -.235, .32, .75, .47, .40, 'n');
  shell.box(-.19, -.285, .33, .81, .57, .10, 'n');
  shell.box(-1.00, -.25, .73, .56, .50, .105, 'n');
  beam(shell, [-.59, 0, .28], [-.36, 0, .68], .13);
  beam(shell, [.68, 0, .29], [.55, 0, 1.08], .12);
  add(shell, '封闭电池仓与宽踏板', materials.shell, materials.shellTop);

  const tires = new Part(), rims = new Part();
  for (const x of [-.64, .68]) {
    tires.cylY(x, -.125, .29, .28, .25, 14, 'n');
    rims.cylY(x, -.132, .29, .15, .264, 10, 'n');
    rims.cylY(x, -.155, .29, .055, .31, 8, 'n');
  }
  add(tires, '厚胎小轮', materials.black, materials.blackTop);
  add(rims, '封闭轮毂', materials.metal, materials.metalTop);

  const paint = new Part();
  paint.extrude([[.45, -.24, .44], [.75, -.24, .49], [.73, -.24, .97], [.56, -.24, 1.16], [.40, -.24, 1.05]], [0, .48, 0], 'n');
  for (const x of [-.64, .68]) {
    const arch: Point[] = [];
    for (let index = 0; index <= 12; index++) { const angle = index / 12 * Math.PI; arch.push([x + Math.cos(angle) * .33, -.16, .29 + Math.sin(angle) * .33]); }
    for (let index = 12; index >= 0; index--) { const angle = index / 12 * Math.PI; arch.push([x + Math.cos(angle) * .298, -.16, .29 + Math.sin(angle) * .298]); }
    paint.extrude(arch, [0, .32, 0], 'n', { seams: false });
  }
  paint.box(-1.07, -.37, .88, .70, .74, .60, 'n');
  paint.box(-1.085, -.385, 1.48, .73, .77, .065, 'n');
  paint.extrude([[-.29, -.155, 1.01], [-.29, .155, 1.01], [-.17, .23, 1.43], [-.17, -.23, 1.43]], [.29, 0, 0], 'n');
  for (const side of [-1, 1]) {
    beam(paint, [-.015, side * .23, 1.385], [.24, side * .27, 1.19], .14);
    beam(paint, [.24, side * .27, 1.19], [.51, side * .30, 1.11], .105);
  }
  sphere(paint, [.065, 0, 1.71], .19, [1.1, .72, 1]);
  paint.box(.16, -.14, 1.66, .145, .28, .035, 'n');
  add(paint, '品牌制服头盔与大餐箱', materials.brand, materials.brandTop);

  const dark = new Part();
  dark.box(-.56, -.25, .77, .78, .50, .11, 'n');
  dark.box(-.145, -.225, .43, .65, .45, .018, 'n');
  dark.box(-1.085, -.385, .87, .73, .77, .045, 'n');
  dark.box(-1.088, -.388, 1.45, .735, .776, .035, 'n');
  for (const x of [-1.015, -.445]) for (const side of [-1, 1]) dark.box(x, side > 0 ? .372 : -.389, .93, .032, .017, .48, 'n');
  dark.box(-.30, -.17, .88, .30, .34, .15, 'n');
  for (const side of [-1, 1]) {
    beam(dark, [-.15, side * .135, .96], [.22, side * .205, .76], .16);
    beam(dark, [.22, side * .205, .76], [.25, side * .205, .49], .125);
    dark.box(.14, side * .205 - .067, .448, .30, .134, .067, 'n');
    beam(dark, [.53, side * .31, 1.11], [.63, side * .32, 1.11], .063);
    beam(dark, [.55, side * .29, 1.15], [.59, side * .385, 1.38], .026);
    dark.box(.535, side * .385 - .068, 1.36, .06, .136, .09, 'n');
    beam(dark, [.085, side * .102, 1.61], [.10, side * .10, 1.50], .018);
  }
  beam(dark, [.53, -.32, 1.11], [.53, .32, 1.11], .055);
  dark.box(.156, -.11, 1.585, .027, .22, .075, 'n');
  dark.box(-.035, -.11, 1.816, .17, .027, .016, 'n');
  dark.box(-.035, .083, 1.816, .17, .027, .016, 'n');
  add(dark, '坐垫裤装踏板双脚与后视镜', materials.black, materials.blackTop);

  const skin = new Part();
  skin.cylZ(.035, 0, 1.48, .105, .23, 8, 'n');
  skin.cylZ(-.005, 0, 1.43, .062, .09, 8, 'n');
  for (const side of [-1, 1]) sphere(skin, [.535, side * .30, 1.11], .053, [1.15, .85, 1]);
  add(skin, '骑手面部与握把双手', materials.skin, materials.skinTop);

  const silver = new Part();
  for (const side of [-1, 1]) {
    silver.box(.536, side * .385 - .055, 1.376, .065, .11, .062, 'n');
    silver.box(-.08, side > 0 ? .231 : -.242, 1.27, .13, .012, .035, 'n');
  }
  silver.box(-1.079, -.292, .98, .009, .584, .035, 'n');
  add(silver, '镜片与餐箱反光条', materials.metal, materials.metalTop);
  const reflector = new Part();
  reflector.box(.072, -.182, 1.225, .019, .364, .027, 'n');
  reflector.box(-.235, -.18, 1.225, .012, .36, .027, 'n');
  add(reflector, '制服反光条', materials.reflective);
  const lamp = new Part(); lamp.box(.746, -.135, .98, .044, .27, .115, 'n');
  add(lamp, '前车灯', materials.lamp);
  const tail = new Part(); tail.box(-1.024, -.105, .735, .028, .21, .055, 'n');
  add(tail, '后尾灯', materials.tail);

  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const decalMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const decal = (corners: [Point, Point, Point, Point]) => {
    const start = positions.length / 3;
    for (const corner of corners) { const point = W(...corner); positions.push(point.x, point.y, point.z); }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1); indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  decal([[-1.015, .375, 1.06], [-.425, .375, 1.06], [-.425, .375, 1.29], [-1.015, .375, 1.29]]);
  decal([[-.425, -.375, 1.06], [-1.015, -.375, 1.06], [-1.015, -.375, 1.29], [-.425, -.375, 1.29]]);
  decal([[-1.076, -.31, 1.06], [-1.076, .31, 1.06], [-1.076, .31, 1.30], [-1.076, -.31, 1.30]]);
  decal([[-.364, .31, 1.06], [-.364, -.31, 1.06], [-.364, -.31, 1.30], [-.364, .31, 1.30]]);
  decal([[-.94, -.30, 1.549], [-.94, .30, 1.549], [-.68, .30, 1.549], [-.68, -.30, 1.549]]);
  decal([[-.247, -.18, 1.25], [-.247, .18, 1.25], [-.190, .20, 1.39], [-.190, -.20, 1.39]]);
  decal([[.058, .18, 1.25], [.058, -.18, 1.25], [.115, -.20, 1.39], [.115, .20, 1.39]]);
  decal([[.277, .125, 1.705], [.277, -.125, 1.705], [.277, -.125, 1.785], [.277, .125, 1.785]]);
  const decalGeometry = new THREE.BufferGeometry();
  decalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  decalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  decalGeometry.setIndex(indices); decalGeometry.computeVertexNormals(); ownGeometry.add(decalGeometry);
  const marks = new THREE.Mesh(decalGeometry, decalMaterial); marks.name = '餐箱四面顶面制服与头盔品牌字样'; marks.renderOrder = 1; group.add(marks);
  let currentBrand: CourierBrand | null = null;
  const setBrand = (brand: CourierBrand) => {
    if (currentBrand === brand) return;
    currentBrand = brand;
    const palette = BRAND[brand];
    materials.brand.color.set(palette.color); materials.brandTop.color.set(palette.top);
    group.name = `${palette.label}电动踏板车骑手`; group.userData.brand = brand;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = palette.color; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = palette.ink; context.font = '900 88px "PingFang SC","Microsoft YaHei",sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(palette.label, 256, 101, 460);
    texture.needsUpdate = true;
  };
  setBrand(initialBrand);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ownGeometry.forEach(geometry => geometry.dispose());
    Object.values(materials).forEach(material => material.dispose());
    decalMaterial.dispose(); texture.dispose(); group.clear();
  };
  return { group, setBrand, dispose };
}
