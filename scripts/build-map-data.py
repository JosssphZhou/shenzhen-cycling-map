#!/usr/bin/env python3
"""离线生成轻量深圳底图。依赖 pyosmium、shapely、pyarrow；不读取或修改骑行轨迹。"""
import argparse
import collections
import gzip
import hashlib
import json
import math
from pathlib import Path

import osmium
import pyarrow.dataset as dataset
from shapely import from_wkt, make_valid
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, unary_union

REPO = Path(__file__).resolve().parents[1]
TASK = REPO.parent.parent
DATE = '2026-10-08'
DISTRICT_IDS = {
    '南山区': 5664195, '福田区': 5664191, '罗湖区': 5664194,
    '盐田区': 5663273, '宝安区': 5664101, '光明区': 5664192,
    '龙华区': 5664193, '龙岗区': 5664102, '坪山区': 4590423,
    '大鹏新区': 3536166,
}
ROAD_KINDS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'cycleway'}
LANDMARKS = [
    ('spring-bamboo', '春笋', '中国华润大厦'),
    ('cocoon', '春茧', '深圳湾体育馆'),
    ('pingan', '平安金融中心', '平安金融中心'),
    ('civic-center', '市民中心', '市民中心'),
    ('kk100', '京基一百', '京基100'),
]


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.pending')
    temporary.write_bytes(encoded(value))
    temporary.replace(path)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def parts(geometry, kind):
    if geometry.is_empty:
        return []
    if geometry.geom_type == kind:
        return [geometry]
    return [part for child in getattr(geometry, 'geoms', []) for part in parts(child, kind)]


def polygon_rings(polygon):
    # 经度精度不能以破坏窄水体或孔洞为代价；必要时保留更高精度。
    for precision in (6, 7, 9, 12):
        rings = [[[round(x, precision), round(y, precision)] for x, y in ring.coords]
                 for ring in [polygon.exterior, *polygon.interiors]]
        check = Polygon(rings[0], rings[1:])
        if check.is_valid and not check.is_empty and check.area > 0:
            return rings
    raise ValueError('面坐标量化后不再有效')


class DistrictReader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.factory = osmium.geom.WKTFactory()
        self.regions = {}

    def area(self, area):
        if area.from_way() or area.orig_id() not in DISTRICT_IDS.values():
            return
        name = next(name for name, relation in DISTRICT_IDS.items() if relation == area.orig_id())
        self.regions[name] = make_valid(from_wkt(self.factory.create_multipolygon(area)))


def read_districts(pbf, cache, pbf_sha):
    saved = json.loads(cache.read_text()) if cache.exists() else None
    if saved and saved.get('pbfSha256') == pbf_sha and set(saved['regions']) == set(DISTRICT_IDS):
        return {name: shape(value) for name, value in saved['regions'].items()}
    reader = DistrictReader()
    reader.apply_file(str(pbf), locations=True, idx='flex_mem')
    if set(reader.regions) != set(DISTRICT_IDS):
        raise ValueError(f'缺少真实区界：{set(DISTRICT_IDS) - set(reader.regions)}')
    write(cache, {'pbfSha256': pbf_sha, 'relations': DISTRICT_IDS,
                  'regions': {name: mapping(region) for name, region in reader.regions.items()}})
    return reader.regions


def validate(data):
    polygons_checked = 0
    for layer in ('land', 'water', 'districts', 'landmarks'):
        for item in data[layer]:
            polygon = Polygon(item['rings'][0], item['rings'][1:])
            if polygon.is_empty or not polygon.is_valid:
                raise ValueError(f'{layer}含无效面：{item.get("id", item.get("name"))}')
            polygons_checked += 1
    if len({road['id'] for road in data['roads']}) != len(data['roads']):
        raise ValueError('道路标识重复')
    for road in data['roads']:
        if len(road['points']) < 2 or LineString(road['points']).length <= 0:
            raise ValueError(f'道路线为空：{road["id"]}')
    land = unary_union([Polygon(item['rings'][0], item['rings'][1:]) for item in data['land']])
    probes = {'福田市民中心': (114.055, 22.548, True), '深圳湾': (113.973, 22.481, False),
              '大鹏中心': (114.476, 22.595, True), '盐田港外海': (114.30, 22.555, False)}
    checks = {name: land.covers(Point(x, y)) == expected for name, (x, y, expected) in probes.items()}
    if not all(checks.values()):
        raise ValueError(f'海陆校验未通过：{checks}')
    displayed = {name: unary_union([Polygon(item['rings'][0], item['rings'][1:]) for item in data['districts'] if item['name'] == name])
                 for name in ('龙岗区', '大鹏新区')}
    if displayed['龙岗区'].equals(displayed['大鹏新区']) or displayed['龙岗区'].intersection(displayed['大鹏新区']).area > 1e-12:
        raise ValueError('输出数据仍存在龙岗与大鹏重复')
    return {'polygonsChecked': polygons_checked, 'roadsChecked': len(data['roads']), 'coastChecks': checks,
            'districtOverlapDegrees': displayed['龙岗区'].intersection(displayed['大鹏新区']).area}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=TASK / 'work/archive-geodata/city.json')
    parser.add_argument('--cache', type=Path, default=TASK / 'work/geodata')
    parser.add_argument('--work', type=Path, default=TASK / 'work/light-map')
    parser.add_argument('--out', type=Path, default=REPO / 'public/data/shenzhen-map.json')
    args = parser.parse_args()
    city = json.loads(args.archive.read_text())
    bounds, center = city['bounds'], city['center']
    east = 111320 * math.cos(math.radians(center[1]))
    north = 111132
    project = lambda geom: affine_transform(geom, [east, 0, 0, north, -center[0] * east, -center[1] * north])
    unproject = lambda geom: affine_transform(geom, [1 / east, 0, 0, 1 / north, center[0], center[1]])
    clipped_bounds = box(*bounds)
    pbf = args.cache / 'guangdong-latest.osm.pbf'
    pbf_sha = sha(pbf)
    raw_regions = read_districts(pbf, args.work / 'district-source.json', pbf_sha)
    city_boundary = shape(json.loads((args.cache / 'shenzhen-boundary.geojson').read_text())['geometry'])

    land = []
    for source in city['land']:
        polygon = Polygon(source['rings'][0], source['rings'][1:])
        if not polygon.is_valid:
            polygon = make_valid(polygon)
        for index, piece in enumerate(parts(unproject(project(polygon).simplify(25, preserve_topology=True)), 'Polygon')):
            land.append({'id': f"{source['id']}-{index}", 'kind': 'land', 'rings': polygon_rings(piece)})

    water = []
    for source in city['water']:
        polygon = make_valid(Polygon(source['rings'][0], source['rings'][1:]))
        if not polygon.intersects(city_boundary):
            continue
        # 具名水体全部保留；无名水面只留超过4万平方米者，省去池塘和微小碎片。
        if not source.get('name') and project(polygon).area < 40000:
            continue
        simplified = unproject(project(polygon.intersection(city_boundary)).simplify(12, preserve_topology=True))
        for index, piece in enumerate(parts(simplified, 'Polygon')):
            water.append({'id': f"{source['id']}-{index}", 'name': source.get('name', ''),
                          'kind': source['kind'], 'rings': polygon_rings(piece)})

    groups = collections.defaultdict(list)
    selected_roads = [road for road in city['roads'] if road['kind'] in ROAD_KINDS]
    for road in selected_roads:
        groups[(road['kind'], road.get('name', ''))].append(LineString(road['points']))
    roads = []
    # 同类别同名且真正相接的线合并；不跨空白补线，不改变交叉路口位置。
    for (kind, name), source_lines in sorted(groups.items()):
        merged = unary_union(source_lines)
        if merged.geom_type == 'MultiLineString':
            merged = linemerge(merged)
        for line in sorted(parts(merged, 'LineString'), key=lambda item: (item.bounds, item.length)):
            metric = project(line)
            if not name and metric.length < 35:
                continue
            simplified = unproject(metric.simplify(18, preserve_topology=True))
            points = [[round(x, 6), round(y, 6)] for x, y in simplified.coords]
            points = [point for index, point in enumerate(points) if index == 0 or point != points[index - 1]]
            if len(points) < 2:
                continue
            key = hashlib.sha256(encoded([kind, name, points])).hexdigest()[:12]
            roads.append({'id': f'osm-{key}', 'name': name, 'kind': kind, 'points': points})
    before_deduplication = len(roads)
    roads = list({road['id']: road for road in roads}.values())

    districts = []
    district_evidence = {}
    for name in DISTRICT_IDS:
        region = raw_regions[name].intersection(clipped_bounds)
        original_count = len(parts(region, 'Polygon'))
        if name == '龙岗区':
            region = region.difference(raw_regions['大鹏新区'])
        if region.is_empty:
            raise ValueError(f'{name}在显示范围内为空')
        # 独立的面分别输出；rings内部只有一个外环以及它真正的孔洞。
        simplified = unproject(project(region).simplify(25, preserve_topology=True))
        pieces = sorted(parts(simplified, 'Polygon'), key=lambda item: (-item.area, item.bounds))
        for piece in pieces:
            point = piece.representative_point()
            districts.append({'name': name, 'center': [round(point.x, 6), round(point.y, 6)], 'rings': polygon_rings(piece)})
        district_evidence[name] = {'osmRelation': DISTRICT_IDS[name], 'sourcePolygonsWithinBounds': original_count,
                                   'displayPolygons': len(pieces), 'bounds': [round(value, 7) for value in region.bounds]}
    longgang = raw_regions['龙岗区'].intersection(clipped_bounds).difference(raw_regions['大鹏新区'])
    dapeng = raw_regions['大鹏新区'].intersection(clipped_bounds)
    if longgang.is_empty or longgang.equals(dapeng) or longgang.intersection(dapeng).area > 1e-12:
        raise ValueError('龙岗、大鹏区界修复未通过')

    landmarks = []
    original_buildings = []
    for model, name, original_name in LANDMARKS:
        building = next(item for item in city['buildings'] if item.get('name') == original_name and item['kind'] == 'building')
        point = Polygon(building['rings'][0], building['rings'][1:]).centroid
        landmark = {'id': model, 'name': name, 'model': model, 'coordinate': [round(point.x, 6), round(point.y, 6)],
                    'rings': building['rings'], 'sourceId': building['id']}
        if building.get('heightSource') == '来源高度':
            landmark['height'] = building['height']
        landmarks.append(landmark)
        original_buildings.append(building)
    original_ids = [building['id'].removeprefix('ovt-').rsplit('-', 1)[0] for building in original_buildings]
    parquet = args.cache / 'shenzhen-buildings.parquet'
    source_rows = dataset.dataset(parquet, format='parquet').to_table(columns=['id', 'sources'], filter=dataset.field('id').isin(original_ids)).to_pylist()
    if len(source_rows) != len(LANDMARKS) or any(source['dataset'] != 'OpenStreetMap' for row in source_rows for source in row['sources']):
        raise ValueError('地标来源发生变化，须重新核对署名')

    data = {
        'version': 1, 'bounds': bounds, 'center': center, 'land': land, 'water': water,
        'roads': roads, 'districts': districts, 'landmarks': landmarks,
        'sources': [
            {'title': 'OpenStreetMap 贡献者；Geofabrik 广东提取（ODbL）', 'url': 'https://download.geofabrik.de/asia/china/guangdong.html', 'published': '2026-10-06', 'checked': DATE},
            {'title': 'Overture Maps Foundation；地标轮廓来自 OpenStreetMap（ODbL）', 'url': 'https://docs.overturemaps.org/attribution/', 'published': '2026-09-23', 'checked': DATE},
        ], 'generated': DATE,
        'statistics': {
            'coordinateSystem': 'WGS84', 'projection': {'origin': center, 'eastMetersPerDegree': east, 'northMetersPerDegree': north},
            'inputCitySha256': sha(args.archive), 'inputPbfSha256': pbf_sha,
            'inputBuildingsSha256': sha(parquet), 'osmTimestamp': '2026-10-06T20:21:06Z', 'overtureRelease': '2026-09-23.1',
            'counts': {'land': len(land), 'water': len(water), 'roads': len(roads), 'districtPolygons': len(districts), 'districtNames': len(DISTRICT_IDS), 'landmarks': len(landmarks)},
            'originalCounts': {'land': len(city['land']), 'water': len(city['water']), 'roads': len(city['roads']), 'selectedRoads': len(selected_roads)},
            'roadKinds': dict(sorted(collections.Counter(road['kind'] for road in roads).items())),
            'identicalQuantizedRoadsRemoved': before_deduplication - len(roads),
            'simplifyMeters': {'land': 25, 'water': 12, 'roads': 18, 'districts': 25, 'landmarks': 0},
            'districtSources': district_evidence,
            'districtRepair': {'rule': '龙岗完整源多面减去已单列的大鹏管理范围', 'longgangEqualsDapeng': False, 'overlapAreaDegrees': longgang.intersection(dapeng).area,
                               'sourceLonggangRoads': sum(LineString(road['points']).intersects(longgang) for road in selected_roads),
                               'outputLonggangRoads': sum(LineString(road['points']).intersects(longgang) for road in roads)},
            'landmarkSources': source_rows,
            'omittedLayers': ['普通建筑', '建筑分片', '高程', '未提取的公园面', '非精选道路类别'],
            'routeGeometryModified': False,
        },
    }
    data['statistics']['validation'] = validate(data)
    raw = encoded(data)
    if len(raw) > 3_000_000:
        raise ValueError(f'底图超过3MB预算：{len(raw)}字节，不写出')
    write(args.out, data)
    report = {'bytes': len(raw), 'gzipBytes': len(gzip.compress(raw, mtime=0)), 'sha256': hashlib.sha256(raw).hexdigest(),
              'counts': data['statistics']['counts'], 'roadKinds': data['statistics']['roadKinds'], 'districtRepair': data['statistics']['districtRepair']}
    write(args.work / 'build-report.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
