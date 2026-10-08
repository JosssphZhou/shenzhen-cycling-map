import * as THREE from 'three';
import { buildCar } from './factory/models/vehicles';
import { buildPerson } from './factory/models/people';
import { buildMetroCar } from './factory/models/metro';
import { buildMotorboat } from './factory/models/sea';
import { pose } from './factory/kernel/part';
import { buildCyclist } from './landmarks';
import { ExactPath, type MiniEntity, type MiniMovement, type Point } from './entities';

interface MovingModel { group: THREE.Group; path: ExactPath; distance: number; speed: number; height: number; kind: MiniMovement['kind']; closed: boolean; s: number; reverse: boolean }
export interface MovingEntity extends MiniEntity { readonly path: ExactPath; readonly s: number; readonly reverse: boolean }
export class CityDynamics {
  readonly group = new THREE.Group();
  readonly entities: MovingEntity[] = [];
  private models: MovingModel[] = [];
  private clock = 80;
  constructor(blueprints: MiniMovement[], places: { zoneAt(point: Point): { name: string }; relatedRoutesAt(point: Point): string[] }) {
    const prototypes: Partial<Record<MiniMovement['kind'], THREE.Group>> = {};
    const prototype = (kind: MiniMovement['kind']): THREE.Group => {
      if (prototypes[kind]) return prototypes[kind]!;
      let group: THREE.Group;
      if (kind === 'bicycle') group = buildCyclist();
      else if (kind === 'car') group = buildCar(false, 'n');
      else if (kind === 'ship') group = buildMotorboat();
      else if (kind === 'person') { group = buildPerson('walker', 2, false); group.getObjectByName('carry')!.visible = false; }
      else { group = new THREE.Group(); for (let i = 0; i < 3; i++) { const car = buildMetroCar(i === 0 ? 'front' : i === 2 ? 'rear' : null); car.position.x = -i * 13.8; group.add(car); } }
      prototypes[kind] = group; return group;
    };
    const titles: Record<MiniMovement['kind'], string> = { bicycle: '骑友', car: '汽车', person: '行人', train: '列车', ship: '游船' };
    const counts: Record<MiniMovement['kind'], number> = { bicycle: 0, car: 0, person: 0, train: 0, ship: 0 };
    blueprints.forEach((blueprint, order) => {
      const path = new ExactPath(blueprint.path, blueprint.closed || false);
      if (!path.length) return;
      for (let index = 0; index < blueprint.count; index++) {
        const group = prototype(blueprint.kind).clone(true);
        if (blueprint.kind === 'bicycle' || blueprint.kind === 'person') group.scale.setScalar(blueprint.scale ?? 1.3);
        this.group.add(group);
        const model: MovingModel = { group, path, distance: ((index + .31 * order) / blueprint.count % 1) * path.length, speed: blueprint.speed, height: blueprint.height || .15, kind: blueprint.kind, closed: blueprint.closed || false, s: 0, reverse: false };
        const title = `${titles[model.kind]} ${String(++counts[model.kind]).padStart(2, '0')}`;
        const entity: MovingEntity = {
          id: title, title, kind: titles[model.kind], groups: [group], followable: true,
          get path() { return model.path; },
          get s() { return model.s; },
          get reverse() { return model.reverse; },
          get relatedRouteIds() { return blueprint.routeId ? [blueprint.routeId] : places.relatedRoutesAt([group.position.x, group.position.z]); },
          info: () => ({ status: model.kind === 'bicycle' ? '骑行中' : model.kind === 'person' ? '步行中' : model.kind === 'ship' ? '航行中' : '行驶中', rows: [['片区', places.zoneAt([group.position.x, group.position.z]).name], ['行程', model.closed ? '环线' : '往返'], ['说明', '城市动态示意，不是实时位置']] }),
          route: () => {
            const next = blueprint.path[model.reverse ? 0 : blueprint.path.length - 1];
            return { path: model.path, s: model.s, closed: model.closed, reverse: model.reverse, next: { x: next[0], y: next[1], name: model.closed ? '环线起点' : '折返点' } };
          },
        };
        group.userData.entity = entity;
        this.entities.push(entity);
        this.models.push(model);
      }
    });
    this.group.name = '真实路线上的动态骑友';
  }
  update(dt: number, paused: boolean, camera: THREE.Camera, weather: '晴' | '雨' | '雾', zoom: number) {
    if (!paused) this.clock += dt;
    for (const model of this.models) {
      const distance = this.clock * model.speed + model.distance;
      const cycle = distance % (model.path.length * (model.closed ? 1 : 2));
      const reverse = !model.closed && cycle > model.path.length;
      model.s = reverse ? model.path.length * 2 - cycle : cycle;
      model.reverse = reverse;
      const position = model.path.at(model.s)!;
      const heading = position.h + (reverse ? Math.PI : 0);
      pose(model.group, position.x, position.y, heading, model.height);
      const screen = model.group.position.clone().project(camera);
      model.group.visible = Math.abs(screen.x) < 1.12 && Math.abs(screen.y) < 1.12 && (model.kind !== 'person' || zoom > .6);
      if (model.kind === 'person' && model.group.visible) {
        const swing = Math.sin(this.clock * 5 + model.distance) * .5;
        model.group.getObjectByName('legL')!.rotation.z = swing;
        model.group.getObjectByName('legR')!.rotation.z = -swing;
        model.group.getObjectByName('armL')!.rotation.z = -swing * .75;
        model.group.getObjectByName('armR')!.rotation.z = swing * .75;
        model.group.getObjectByName('umbrella')!.visible = weather === '雨';
      }
    }
  }
  get counts() { return { visible: this.models.filter(model => model.group.visible).length, total: this.models.length }; }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    this.group.traverse(object => { const geometry = (object as THREE.Mesh).geometry; if (geometry) geometries.add(geometry); });
    for (const geometry of geometries) geometry.dispose();
  }
}
