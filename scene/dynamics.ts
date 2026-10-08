import * as THREE from 'three';
import { buildCar } from './factory/models/vehicles';
import { buildPerson } from './factory/models/people';
import { buildMetroCar } from './factory/models/metro';
import { buildMotorboat } from './factory/models/sea';
import { pose } from './factory/kernel/part';
import { buildCyclist } from './landmarks';
import { Path } from './factory/kernel/path';
import type { MiniMovement } from './miniature';

interface MovingModel { group: THREE.Group; path: Path; distance: number; speed: number; height: number; kind: MiniMovement['kind']; closed: boolean }
export class CityDynamics {
  readonly group = new THREE.Group();
  private models: MovingModel[] = [];
  private clock = 80;
  constructor(blueprints: MiniMovement[]) {
    const prototypes = {
      car: buildCar(false, 'n') as THREE.Group,
      person: buildPerson('walker', 2, false) as THREE.Group,
      bicycle: buildCyclist(),
      ship: buildMotorboat() as THREE.Group,
      train: new THREE.Group(),
    };
    prototypes.person.getObjectByName('carry')!.visible = false;
    for (let index = 0; index < 3; index++) { const car = buildMetroCar(index === 0 ? 'front' : index === 2 ? 'rear' : null); car.position.x = -index * 13.8; prototypes.train.add(car); }
    blueprints.forEach((blueprint, order) => {
      const path = new Path(blueprint.path, blueprint.kind === 'train' ? 20 : 8, blueprint.closed || false);
      for (let index = 0; index < blueprint.count; index++) {
        const group = prototypes[blueprint.kind].clone(true);
        if (blueprint.kind === 'bicycle' || blueprint.kind === 'person') group.scale.setScalar(1.3);
        this.group.add(group);
        this.models.push({ group, path, distance: ((index + .31 * order) / blueprint.count % 1) * path.length, speed: blueprint.speed, height: blueprint.height || .15, kind: blueprint.kind, closed: blueprint.closed || false });
      }
    });
    this.group.name = '原作人物车辆与骑友';
  }
  update(dt: number, paused: boolean, camera: THREE.Camera, weather: '晴' | '雨' | '雾', zoom: number) {
    if (!paused) this.clock += dt;
    for (const model of this.models) {
      const distance = this.clock * model.speed + model.distance;
      const cycle = distance % (model.path.length * (model.closed ? 1 : 2));
      const reverse = !model.closed && cycle > model.path.length;
      const position = model.path.at(reverse ? model.path.length * 2 - cycle : cycle)!;
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
