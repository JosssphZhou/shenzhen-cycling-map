import type { Coordinate } from '@/lib/types';
import type { DeliverySceneState } from './scene-contract';

export type DeliveryMode = 'focus' | 'demo';
export type OrderPhase = 'queued' | 'to-pickup' | 'waiting' | 'to-dropoff' | 'delivered' | 'cancelled';
export interface DeliveryPlace { id: string; name: string; kind: 'merchant' | 'customer'; area: string; coordinate: Coordinate; node: number }
export interface DeliveryLandmark { id: string; name: string; area: string; coordinate: Coordinate }
export interface DeliveryNetwork {
  version: 1;
  nodes: Coordinate[];
  edges: [from: number, to: number, meters: number][];
  places: DeliveryPlace[];
  landmarks: DeliveryLandmark[];
  source: string;
}
export interface DeliveryEvent { kind: 'waiting' | 'rain' | 'detour' | 'normal'; title: string; story: string; atMinute: number }
export interface DeliveryOrder {
  id: string;
  merchant: DeliveryPlace;
  customer: DeliveryPlace;
  pickupPath: Coordinate[];
  deliveryPath: Coordinate[];
  startMinute: number;
  pickupMinute: number;
  departMinute: number;
  deliveredMinute: number;
  deadlineMinute: number;
  feeCents: number;
  penaltyCents: number;
  event: DeliveryEvent;
  distanceMeters: number;
}
export interface DeliveryShift {
  id: string;
  mode: DeliveryMode;
  startedAt: number;
  realDurationMs: number;
  minutes: number;
  orders: DeliveryOrder[];
  origin: Coordinate;
  originResumePath: Coordinate[];
  ownedItems: string[];
  landmarks: DeliveryLandmark[];
}
export interface DeliveryOrderProgress { order: DeliveryOrder; phase: OrderPhase; earnedCents: number; late: boolean }
export interface DeliveryProgress {
  phase: 'active' | 'finished';
  elapsedMinutes: number;
  remainingMs: number;
  progress: number;
  completedCount: number;
  earnedCents: number;
  currentOrder: DeliveryOrder | null;
  currentPhase: OrderPhase;
  orders: DeliveryOrderProgress[];
  events: DeliveryEvent[];
  scene: DeliverySceneState;
  resumePath: Coordinate[];
  distanceMeters: number;
}
export interface DeliveryReceipt {
  id: string;
  mode: DeliveryMode;
  endedAt: number;
  minutes: number;
  plannedMinutes: number;
  early: boolean;
  completedOrders: number;
  cancelledOrders: number;
  grossCents: number;
  penaltyCents: number;
  earnedCents: number;
  ratingChange: number;
  distanceMeters: number;
  areas: string[];
  landmarks: DeliveryLandmark[];
  orders: DeliveryOrderProgress[];
  position: Coordinate;
}
export interface DeliveryProfile {
  version: 1;
  mode: DeliveryMode;
  walletCents: number;
  rating: number;
  completedOrders: number;
  totalFocusMinutes: number;
  position: Coordinate;
  resumePath: Coordinate[];
  visitedAreas: string[];
  visitedLandmarks: string[];
  familiarShops: Record<string, number>;
  ownedItems: string[];
  activeShift: DeliveryShift | null;
  receipts: DeliveryReceipt[];
}
export interface DeliveryUpgrade {
  id: string;
  name: string;
  category: 'equipment' | 'vehicle' | 'home';
  priceCents: number;
  description: string;
}
export type ProfileLoad = { kind: 'ok'; profile: DeliveryProfile } | { kind: 'empty' } | { kind: 'invalid'; message: string };
export type PurchaseResult = { ok: true; profile: DeliveryProfile } | { ok: false; profile: DeliveryProfile; message: string };

export const DELIVERY_UPGRADES: DeliveryUpgrade[] = [
  { id: 'insulated-box', name: '保温餐箱', category: 'equipment', priceCents: 1200, description: '等餐超时的扣费减少一半。' },
  { id: 'raincoat', name: '防水雨衣', category: 'equipment', priceCents: 1800, description: '雨天超时的扣费减少一半。' },
  { id: 'city-bike', name: '轻便电动车', category: 'vehicle', priceCents: 6800, description: '下一趟配送费增加百分之十。' },
  { id: 'window-plant', name: '窗边绿植', category: 'home', priceCents: 2600, description: '给收工后的住处添一点绿色。' },
];

export const STORAGE_KEYS = { focus: 'shenzhen-delivery-prototype:focus:v1', demo: 'shenzhen-delivery-prototype:demo:v1' } satisfies Record<DeliveryMode, string>;
const START_POSITION: Coordinate = [113.9425627, 22.524858];
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const distance = (a: Coordinate, b: Coordinate) => Math.hypot((a[0] - b[0]) * 102500, (a[1] - b[1]) * 111195);
const same = (a: Coordinate, b: Coordinate) => a[0] === b[0] && a[1] === b[1];
const join = (...paths: Coordinate[][]): Coordinate[] => {
  const points: Coordinate[] = [];
  for (const path of paths) for (const point of path) if (!points.length || !same(points[points.length - 1], point)) points.push(point);
  return points;
};
function length(path: Coordinate[]) { let meters = 0; for (let index = 1; index < path.length; index++) meters += distance(path[index - 1], path[index]); return meters; }
function along(path: Coordinate[], fraction: number) {
  if (path.length < 2) return { prefix: path, position: path[0] ?? START_POSITION, resume: path };
  const target = length(path) * clamp(fraction, 0, 1), prefix: Coordinate[] = [path[0]];
  let traveled = 0;
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index], segment = distance(a, b);
    if (traveled + segment >= target && segment > 0) {
      const amount = clamp((target - traveled) / segment, 0, 1);
      const position: Coordinate = amount === 0 ? a : amount === 1 ? b : [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
      return { prefix: join(prefix, [position]), position, resume: same(position, b) ? [b] : [position, b] };
    }
    traveled += segment; prefix.push(b);
  }
  return { prefix: path, position: path[path.length - 1], resume: [path[path.length - 1]] };
}

interface Neighbor { node: number; meters: number }
const graphCache = new WeakMap<DeliveryNetwork, Neighbor[][]>();
function graph(network: DeliveryNetwork) {
  const known = graphCache.get(network); if (known) return known;
  const adjacency: Neighbor[][] = network.nodes.map(() => []);
  for (const [a, b, meters] of network.edges) { adjacency[a].push({ node: b, meters }); adjacency[b].push({ node: a, meters }); }
  graphCache.set(network, adjacency); return adjacency;
}
function closestNode(network: DeliveryNetwork, position: Coordinate) {
  let nearest = 0, smallest = Infinity;
  network.nodes.forEach((point, index) => { const meters = distance(position, point); if (meters < smallest) { nearest = index; smallest = meters; } });
  if (smallest > 2) throw new Error('上次停留位置无法接回这份路网，请保留存档并重新载入页面。');
  return nearest;
}
function route(network: DeliveryNetwork, from: number, to: number): Coordinate[] {
  if (from === to) return [network.nodes[from]];
  const adjacency = graph(network), costs = new Float64Array(network.nodes.length).fill(Infinity), previous = new Int32Array(network.nodes.length).fill(-1);
  const heap: { node: number; priority: number }[] = [];
  function push(item: { node: number; priority: number }) {
    heap.push(item); let index = heap.length - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (heap[parent].priority <= item.priority) break; heap[index] = heap[parent]; index = parent; }
    heap[index] = item;
  }
  function pop() {
    const first = heap[0], last = heap.pop(); if (!last || !heap.length) return first;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1; if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++;
      if (heap[child].priority >= last.priority) break; heap[index] = heap[child]; index = child;
    }
    heap[index] = last; return first;
  }
  costs[from] = 0; push({ node: from, priority: distance(network.nodes[from], network.nodes[to]) });
  while (heap.length) {
    const current = pop(); if (current.node === to) break;
    if (current.priority > costs[current.node] + distance(network.nodes[current.node], network.nodes[to]) + .01) continue;
    for (const neighbor of adjacency[current.node]) {
      const cost = costs[current.node] + neighbor.meters;
      if (cost >= costs[neighbor.node]) continue;
      costs[neighbor.node] = cost; previous[neighbor.node] = current.node;
      push({ node: neighbor.node, priority: cost + distance(network.nodes[neighbor.node], network.nodes[to]) });
    }
  }
  if (previous[to] < 0) throw new Error('这两个取送点没有连续道路，暂时不能派单。');
  const points: Coordinate[] = []; let cursor = to;
  while (cursor !== from) { points.push(network.nodes[cursor]); cursor = previous[cursor]; }
  points.push(network.nodes[from]); return points.reverse();
}
function random(seed: number) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function localPlace(network: DeliveryNetwork, node: number, kind: DeliveryPlace['kind']): DeliveryPlace {
  const area = [...network.places].sort((a, b) => distance(a.coordinate, network.nodes[node]) - distance(b.coordinate, network.nodes[node]))[0]?.area ?? '后海';
  return { id: `${kind}-${node}`, name: `${area}·${kind === 'merchant' ? '街边饭堂' : '附近取餐点'}`, kind, area, node, coordinate: network.nodes[node] };
}
function shortDelivery(network: DeliveryNetwork, from: number, maximum: number, rng: () => number) {
  const adjacency = graph(network), visited = new Set([from]), path: Coordinate[] = [network.nodes[from]];
  let node = from, meters = 0;
  while (meters < maximum * .75 && visited.size < 1000) {
    const options = adjacency[node].filter(edge => !visited.has(edge.node) && meters + edge.meters <= maximum);
    if (!options.length) break;
    const next = options[Math.floor(rng() * options.length)];
    meters += next.meters; node = next.node; visited.add(node); path.push(network.nodes[node]);
  }
  if (meters < 20) throw new Error('当前位置附近没有适合这段时长的配送道路，请选择更长的专注时间。');
  return { customer: localPlace(network, node, 'customer'), path };
}

export function createProfile(mode: DeliveryMode): DeliveryProfile {
  return { version: 1, mode, walletCents: 0, rating: 5, completedOrders: 0, totalFocusMinutes: 0, position: [...START_POSITION], resumePath: [START_POSITION], visitedAreas: ['后海'], visitedLandmarks: [], familiarShops: {}, ownedItems: [], activeShift: null, receipts: [] };
}

export function planShift({ network, profile, minutes, mode, now }: { network: DeliveryNetwork; profile: DeliveryProfile; minutes: number; mode: DeliveryMode; now: number }): DeliveryShift {
  if (profile.activeShift) throw new Error('这一趟还在配送，收工后才能重新开工。');
  if (profile.mode !== mode || !Number.isFinite(now)) throw new Error('存档或开始时间不正确，请重新载入。');
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) throw new Error('请选择5至180分钟的专注时间。');
  const count = Math.max(1, Math.floor(minutes / 18)), rng = random(Math.floor(now) ^ profile.completedOrders * 1987);
  const resume = profile.resumePath.length ? profile.resumePath : [profile.position];
  let cursor = closestNode(network, resume[resume.length - 1]);
  const firstShift = profile.receipts.length === 0, orders: DeliveryOrder[] = [];
  let time = 0;
  for (let index = 0; index < count; index++) {
    const budget = minutes / count;
    const near = network.places.filter(place => place.kind === 'merchant').sort((a, b) => distance(a.coordinate, network.nodes[cursor]) - distance(b.coordinate, network.nodes[cursor])).slice(0, 5);
    const pickups = near.map(merchant => ({ merchant, path: route(network, cursor, merchant.node) })).sort((a, b) => length(a.path) - length(b.path));
    const nearPickups = pickups.filter(pickup => length(pickup.path) <= budget * 60);
    const pickup = nearPickups.length ? nearPickups[Math.floor(rng() * Math.min(2, nearPickups.length))] : { merchant: localPlace(network, cursor, 'merchant'), path: [network.nodes[cursor]] };
    const merchant = pickup?.merchant;
    if (!merchant) throw new Error('配送点尚未载入，请重新载入页面。');
    const options = network.places.filter(place => place.kind === 'customer' && distance(place.coordinate, merchant.coordinate) > 250 && distance(place.coordinate, merchant.coordinate) < Math.min(3500, budget * 150));
    const ranked = options.sort((a, b) => Math.abs(distance(a.coordinate, merchant.coordinate) - budget * 95) - Math.abs(distance(b.coordinate, merchant.coordinate) - budget * 95));
    const candidates = ranked.slice(0, 8).map(customer => ({ customer, path: route(network, merchant.node, customer.node) }));
    const feasible = candidates.filter(candidate => length(pickup.path) + length(candidate.path) <= budget * 220);
    const chosen = feasible.length ? feasible[Math.floor(rng() * feasible.length)] : shortDelivery(network, merchant.node, Math.max(100, budget * 200 - length(pickup.path)), rng);
    if (!chosen) throw new Error('附近还没有可用的连续配送路线。');
    const customer = chosen.customer;
    const pickupPath = join(index === 0 ? resume : [], pickup.path);
    let deliveryPath = chosen.path;
    const kind: DeliveryEvent['kind'] = firstShift && index === 0 ? 'waiting' : (['normal', 'normal', 'rain', 'detour', 'waiting'] satisfies DeliveryEvent['kind'][])[Math.floor(rng() * 5)];
    if (kind === 'detour') {
      const waypoint = network.places.find(place => place.id !== merchant.id && place.id !== customer.id && distance(place.coordinate, merchant.coordinate) > 250 && distance(place.coordinate, merchant.coordinate) < 900);
      if (waypoint) {
        const detour = join(route(network, merchant.node, waypoint.node), route(network, waypoint.node, customer.node));
        if (length(pickupPath) + length(detour) <= budget * 240) deliveryPath = detour;
      }
    }
    const total = index === count - 1 ? minutes - time : minutes / count * (.86 + rng() * .24);
    const pickupRatio = clamp(length(pickupPath) / Math.max(1, length(pickupPath) + length(deliveryPath)), .12, .44);
    const pickupMinute = time + total * pickupRatio * .78;
    const departMinute = pickupMinute + total * (kind === 'waiting' ? .22 : .1);
    const deliveredMinute = time + total;
    const eventText = {
      waiting: ['店里正在赶单', '店员多送了一句抱歉。等餐耽误了时间，这单按超时结算。'],
      rain: ['路上落起阵雨', '雨水打在餐箱上。骑手放慢速度抵达，配送费扣除一部分。'],
      detour: ['前方临时绕行', '原路口暂时封闭，骑手沿附近道路绕行，这单没赶上约定时间。'],
      normal: ['一路顺利', '顾客已经在楼下等候，这单准时送到。'],
    } satisfies Record<DeliveryEvent['kind'], [string, string]>;
    const [title, story] = eventText[kind], affected = kind !== 'normal';
    let penaltyCents = affected ? 300 + Math.floor(rng() * 150) : 0;
    if (kind === 'waiting' && profile.ownedItems.includes('insulated-box') || kind === 'rain' && profile.ownedItems.includes('raincoat')) penaltyCents = Math.round(penaltyCents / 2);
    const feeCents = Math.round((1100 + rng() * 400) * (profile.ownedItems.includes('city-bike') ? 1.1 : 1));
    orders.push({ id: `order-${Math.floor(now)}-${index + 1}`, merchant, customer, pickupPath, deliveryPath, startMinute: time, pickupMinute, departMinute, deliveredMinute, deadlineMinute: affected ? deliveredMinute - Math.min(3, total * .13) : deliveredMinute + .5, feeCents, penaltyCents, event: { kind, title, story, atMinute: kind === 'waiting' ? pickupMinute : departMinute }, distanceMeters: Math.round(length(pickupPath) + length(deliveryPath)) });
    time = deliveredMinute; cursor = customer.node;
  }
  return { id: `${mode}-${Math.floor(now)}`, mode, startedAt: now, realDurationMs: mode === 'demo' ? minutes / 45 * 90000 : minutes * 60000, minutes, orders, origin: profile.position, originResumePath: resume, ownedItems: [...profile.ownedItems], landmarks: network.landmarks };
}

const fullPathCache = new WeakMap<DeliveryShift, Coordinate[]>();
function fullPath(shift: DeliveryShift) {
  let path = fullPathCache.get(shift); if (!path) { path = join(...shift.orders.flatMap(order => [order.pickupPath, order.deliveryPath])); fullPathCache.set(shift, path); } return path;
}

export function readShift({ shift, now }: { shift: DeliveryShift; now: number }): DeliveryProgress {
  const elapsedMs = clamp(now - shift.startedAt, 0, shift.realDurationMs), progress = elapsedMs / shift.realDurationMs, elapsedMinutes = progress * shift.minutes;
  let completedPath: Coordinate[] = [shift.origin], position = shift.origin, resumePath = shift.originResumePath;
  const orders: DeliveryOrderProgress[] = shift.orders.map(order => {
    const phase: OrderPhase = elapsedMinutes >= order.deliveredMinute ? 'delivered' : elapsedMinutes < order.startMinute ? 'queued' : elapsedMinutes < order.pickupMinute ? 'to-pickup' : elapsedMinutes < order.departMinute ? 'waiting' : 'to-dropoff';
    if (phase === 'delivered') { completedPath = join(completedPath, order.pickupPath, order.deliveryPath); position = order.customer.coordinate; resumePath = [position]; }
    else if (phase !== 'queued') {
      const activePath = phase === 'to-pickup' ? order.pickupPath : order.deliveryPath;
      const fraction = phase === 'to-pickup' ? (elapsedMinutes - order.startMinute) / (order.pickupMinute - order.startMinute) : phase === 'waiting' ? 0 : (elapsedMinutes - order.departMinute) / (order.deliveredMinute - order.departMinute);
      const at = along(activePath, fraction);
      completedPath = join(completedPath, phase === 'to-pickup' ? [] : order.pickupPath, at.prefix);
      position = at.position; resumePath = at.resume;
    }
    return { order, phase, earnedCents: phase === 'delivered' ? order.feeCents - order.penaltyCents : 0, late: elapsedMinutes > order.deadlineMinute && order.deliveredMinute > order.deadlineMinute };
  });
  const current = orders.find(order => order.phase !== 'delivered' && order.phase !== 'queued'), currentOrder = current?.order ?? null, currentPhase = current?.phase ?? (progress >= 1 ? 'delivered' : 'queued');
  const status = progress >= 1 ? '这一趟已送达' : currentPhase === 'waiting' ? '店里等餐' : currentPhase === 'to-pickup' ? '正在赶往商家' : '正在送往顾客';
  return {
    phase: progress >= 1 ? 'finished' : 'active', elapsedMinutes, remainingMs: Math.max(0, shift.realDurationMs - elapsedMs), progress,
    completedCount: orders.filter(order => order.phase === 'delivered').length, earnedCents: orders.reduce((sum, order) => sum + order.earnedCents, 0),
    currentOrder, currentPhase, orders, events: shift.orders.filter(order => order.event.atMinute <= elapsedMinutes).map(order => order.event), resumePath, distanceMeters: Math.round(length(completedPath)),
    scene: { position, path: fullPath(shift), completedPath, stops: shift.orders.flatMap(order => [{ coordinate: order.merchant.coordinate, label: order.merchant.name, kind: 'pickup', done: elapsedMinutes >= order.pickupMinute }, { coordinate: order.customer.coordinate, label: order.customer.name, kind: 'dropoff', done: elapsedMinutes >= order.deliveredMinute }]), status, active: progress < 1 },
  };
}

export function idleScene(profile: DeliveryProfile): DeliverySceneState {
  return { position: profile.position, path: [], completedPath: [], stops: [], status: '收工休息中', active: false };
}

export function settleShift({ profile, now, early = false }: { profile: DeliveryProfile; now: number; early?: boolean }): { profile: DeliveryProfile; receipt: DeliveryReceipt | null } {
  const shift = profile.activeShift;
  if (!shift) return { profile, receipt: null };
  if (profile.receipts.some(receipt => receipt.id === shift.id)) return { profile: { ...profile, activeShift: null }, receipt: null };
  const progress = readShift({ shift, now });
  if (!early && progress.phase !== 'finished') return { profile, receipt: null };
  const completed = progress.orders.filter(order => order.phase === 'delivered'), cancelledOrders = shift.orders.length - completed.length;
  const orders: DeliveryOrderProgress[] = progress.orders.map(order => order.phase === 'delivered' ? order : { ...order, phase: 'cancelled' });
  const grossCents = completed.reduce((sum, order) => sum + order.order.feeCents, 0), penaltyCents = completed.reduce((sum, order) => sum + order.order.penaltyCents, 0);
  const change = completed.reduce((sum, order) => sum + (order.late ? -.12 : .04), 0) - cancelledOrders * .18;
  const rating = Math.round(clamp(profile.rating + change, 1, 5) * 100) / 100;
  const areas = [...new Set(completed.flatMap(order => [order.order.merchant.area, order.order.customer.area]))];
  const landmarks = shift.landmarks.filter(landmark => progress.scene.completedPath.some(point => distance(point, landmark.coordinate) < 500));
  const receipt: DeliveryReceipt = { id: shift.id, mode: shift.mode, endedAt: Math.min(now, shift.startedAt + shift.realDurationMs), minutes: Math.round(progress.elapsedMinutes * 100) / 100, plannedMinutes: shift.minutes, early: progress.phase !== 'finished', completedOrders: completed.length, cancelledOrders, grossCents, penaltyCents, earnedCents: grossCents - penaltyCents, ratingChange: Math.round((rating - profile.rating) * 100) / 100, distanceMeters: progress.distanceMeters, areas, landmarks, orders, position: progress.scene.position };
  const familiarShops = { ...profile.familiarShops };
  for (const order of progress.orders) if (progress.elapsedMinutes >= order.order.pickupMinute) familiarShops[order.order.merchant.id] = (familiarShops[order.order.merchant.id] || 0) + 1;
  return { profile: { ...profile, walletCents: profile.walletCents + receipt.earnedCents, rating, completedOrders: profile.completedOrders + completed.length, totalFocusMinutes: Math.round((profile.totalFocusMinutes + receipt.minutes) * 100) / 100, position: receipt.position, resumePath: progress.resumePath, visitedAreas: [...new Set([...profile.visitedAreas, ...areas])], visitedLandmarks: [...new Set([...profile.visitedLandmarks, ...landmarks.map(landmark => landmark.id)])], familiarShops, activeShift: null, receipts: [receipt, ...profile.receipts].slice(0, 8) }, receipt };
}

export function buyUpgrade({ profile, itemId }: { profile: DeliveryProfile; itemId: string }): PurchaseResult {
  const item = DELIVERY_UPGRADES.find(candidate => candidate.id === itemId);
  if (!item) return { ok: false, profile, message: '这件装备还没有上架。' };
  if (profile.activeShift) return { ok: false, profile, message: '收工后再来添置装备。' };
  if (profile.ownedItems.includes(itemId)) return { ok: false, profile, message: '这件物品已经拥有了。' };
  if (profile.walletCents < item.priceCents) return { ok: false, profile, message: '配送费还不够，再跑一趟攒攒。' };
  return { ok: true, profile: { ...profile, walletCents: profile.walletCents - item.priceCents, ownedItems: [...profile.ownedItems, itemId] } };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => number(value) && value >= 0;
const integer = (value: unknown): value is number => nonnegative(value) && Number.isInteger(value);
const string = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const modeValue = (value: unknown): value is DeliveryMode => value === 'focus' || value === 'demo';
const coordinate = (value: unknown): value is Coordinate => Array.isArray(value) && value.length === 2 && number(value[0]) && number(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const pathValue = (value: unknown): value is Coordinate[] => Array.isArray(value) && value.length > 0 && value.every(coordinate);
function placeValue(value: unknown): value is DeliveryPlace { return record(value) && string(value.id) && string(value.name) && (value.kind === 'merchant' || value.kind === 'customer') && string(value.area) && coordinate(value.coordinate) && integer(value.node); }
function landmarkValue(value: unknown): value is DeliveryLandmark { return record(value) && string(value.id) && string(value.name) && string(value.area) && coordinate(value.coordinate); }
function eventValue(value: unknown): value is DeliveryEvent { return record(value) && ['waiting', 'rain', 'detour', 'normal'].includes(String(value.kind)) && string(value.title) && string(value.story) && nonnegative(value.atMinute); }
function orderValue(value: unknown): value is DeliveryOrder {
  if (!record(value)) return false;
  return string(value.id) && placeValue(value.merchant) && placeValue(value.customer) && pathValue(value.pickupPath) && pathValue(value.deliveryPath)
    && number(value.startMinute) && number(value.pickupMinute) && number(value.departMinute) && number(value.deliveredMinute) && number(value.deadlineMinute)
    && value.startMinute >= 0 && value.pickupMinute > value.startMinute && value.departMinute > value.pickupMinute && value.deliveredMinute > value.departMinute
    && integer(value.feeCents) && integer(value.penaltyCents) && value.penaltyCents <= value.feeCents && eventValue(value.event) && nonnegative(value.distanceMeters);
}
function shiftValue(value: unknown): value is DeliveryShift {
  if (!record(value) || !Array.isArray(value.orders)) return false;
  return string(value.id) && modeValue(value.mode) && number(value.startedAt) && number(value.realDurationMs) && value.realDurationMs > 0 && number(value.minutes) && value.minutes >= 5 && value.minutes <= 180
    && value.orders.length > 0 && value.orders.length <= 10 && value.orders.every(orderValue) && coordinate(value.origin) && pathValue(value.originResumePath) && strings(value.ownedItems)
    && Array.isArray(value.landmarks) && value.landmarks.every(landmarkValue);
}
function orderProgressValue(value: unknown): value is DeliveryOrderProgress {
  return record(value) && orderValue(value.order) && ['queued', 'to-pickup', 'waiting', 'to-dropoff', 'delivered', 'cancelled'].includes(String(value.phase)) && integer(value.earnedCents) && typeof value.late === 'boolean';
}
function receiptValue(value: unknown): value is DeliveryReceipt {
  return record(value) && string(value.id) && modeValue(value.mode) && number(value.endedAt) && nonnegative(value.minutes) && nonnegative(value.plannedMinutes) && typeof value.early === 'boolean'
    && integer(value.completedOrders) && integer(value.cancelledOrders) && integer(value.grossCents) && integer(value.penaltyCents) && integer(value.earnedCents) && number(value.ratingChange)
    && nonnegative(value.distanceMeters) && strings(value.areas) && Array.isArray(value.landmarks) && value.landmarks.every(landmarkValue)
    && Array.isArray(value.orders) && value.orders.every(orderProgressValue) && coordinate(value.position);
}
function profileValue(value: unknown): value is DeliveryProfile {
  return record(value) && value.version === 1 && modeValue(value.mode) && integer(value.walletCents) && number(value.rating) && value.rating >= 1 && value.rating <= 5
    && integer(value.completedOrders) && nonnegative(value.totalFocusMinutes) && coordinate(value.position) && pathValue(value.resumePath) && strings(value.visitedAreas) && strings(value.visitedLandmarks)
    && record(value.familiarShops) && Object.values(value.familiarShops).every(integer) && strings(value.ownedItems) && (value.activeShift === null || shiftValue(value.activeShift))
    && Array.isArray(value.receipts) && value.receipts.every(receiptValue);
}

export function parseNetwork(input: unknown): DeliveryNetwork {
  if (!record(input) || input.version !== 1 || !Array.isArray(input.nodes) || input.nodes.length === 0 || !input.nodes.every(coordinate)) throw new Error('配送路网尚未完整载入。');
  const nodes = input.nodes;
  const edgeValue = (edge: unknown): edge is [number, number, number] => Array.isArray(edge) && edge.length === 3 && integer(edge[0]) && integer(edge[1]) && edge[0] < nodes.length && edge[1] < nodes.length && nonnegative(edge[2]);
  if (!Array.isArray(input.edges) || input.edges.length === 0 || !input.edges.every(edgeValue) || !Array.isArray(input.places) || input.places.length < 2 || !input.places.every(placeValue) || !input.places.every(place => place.node < nodes.length && same(place.coordinate, nodes[place.node])) || !Array.isArray(input.landmarks) || !input.landmarks.every(landmarkValue) || !string(input.source)) throw new Error('配送路网格式不完整，请重新载入。');
  return { version: 1, nodes, edges: input.edges, places: input.places, landmarks: input.landmarks, source: input.source };
}

export function loadProfile(mode: DeliveryMode): ProfileLoad {
  try {
    if (typeof window === 'undefined') return { kind: 'empty' };
    const stored = window.localStorage.getItem(STORAGE_KEYS[mode]);
    if (stored === null) return { kind: 'empty' };
    const profile: unknown = JSON.parse(stored);
    if (!profileValue(profile) || profile.mode !== mode || profile.activeShift && profile.activeShift.mode !== mode) return { kind: 'invalid', message: '这份原型存档格式不完整。原存档已保留，请换用另一种模式体验。' };
    return { kind: 'ok', profile };
  } catch { return { kind: 'invalid', message: '暂时无法读取本地存档。原存档未改动，请允许此页面使用本地存储后重试。' }; }
}

export function saveProfile(profile: DeliveryProfile): void {
  if (typeof window === 'undefined') throw new Error('请在浏览器中保存这份原型进度。');
  try { window.localStorage.setItem(STORAGE_KEYS[profile.mode], JSON.stringify(profile)); }
  catch { throw new Error('本地存档没有保存成功，请留在页面并检查浏览器存储空间。'); }
}

export async function transactProfile({ mode, change }: { mode: DeliveryMode; change: (profile: DeliveryProfile) => DeliveryProfile }): Promise<DeliveryProfile> {
  const update = () => {
    const loaded = loadProfile(mode);
    if (loaded.kind === 'invalid') throw new Error(loaded.message);
    const current = loaded.kind === 'ok' ? loaded.profile : createProfile(mode);
    const next = change(current);
    if (next.mode !== mode) throw new Error('试玩与正常专注使用各自的存档。');
    if (next !== current) saveProfile(next);
    return next;
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(STORAGE_KEYS[mode], update);
  return update();
}
