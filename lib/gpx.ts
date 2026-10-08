import type { Coordinate, CyclingRoute } from './types';

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceBetweenKm(a: Coordinate, b: Coordinate): number {
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function measureDistanceKm(segments: Coordinate[][]): number {
  return segments.reduce((total, points) => total + points.slice(1).reduce(
    (length, point, index) => length + distanceBetweenKm(points[index], point), 0,
  ), 0);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

/** 仅导出核对过的单条连续轨迹；不补连接线，不平滑，不编造高程或时间。 */
export function createGpx(route: CyclingRoute): string {
  if (!route.exportable || route.geometryStatus !== '已核对路网' || route.status === '待核') {
    throw new Error('这条路线的轨迹尚未核对，暂不支持导出。');
  }
  if (route.geometry.length !== 1 || route.geometry[0].length < 2) {
    throw new Error('轨迹存在断点，不能导出为连续骑行路线。');
  }
  for (const point of route.geometry[0]) {
    if (point.length !== 2 || !point.every(Number.isFinite)
      || point[0] < 113.7 || point[0] > 114.7 || point[1] < 22.4 || point[1] > 22.9) {
      throw new Error('轨迹坐标无效，已停止导出。');
    }
  }
  const distance = measureDistanceKm(route.geometry);
  if (route.distanceKm === null || Math.abs(distance - route.distanceKm) > 0.011) {
    throw new Error('轨迹距离与路线资料不一致，已停止导出。');
  }
  const description = [route.summary, route.geometryNote, ...route.restrictions,
    '开放地图贡献者；ODbL 1.0。此文件用于骑前参考，现场管理要求优先。',
  ].join('；');
  const points = route.geometry[0].map(([lon, lat]) =>
    `      <trkpt lat="${lat}" lon="${lon}" />`,
  ).join('\n');
  const links = route.sources.map((source) =>
    `    <link href="${escapeXml(source.url)}"><text>${escapeXml(source.title)}</text></link>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="深圳骑行地图" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(route.name)}</name>
    <desc>${escapeXml(description)}</desc>
    <copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>
${links}
  </metadata>
  <trk>
    <name>${escapeXml(route.name)}</name>
    <type>骑行</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}
