#!/usr/bin/env python3
"""离线恢复完整深圳城市数据，保留已修正的区界与地标。只需 Python 标准库。"""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import shutil

REPO = Path(__file__).resolve().parents[1]
TASK = REPO.parent.parent
DATE = '2026-10-10'
UNCHANGED_LAYERS = ('bounds', 'center', 'land', 'water', 'roads', 'buildings', 'terrain', 'buildingTiles')


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def atomic_write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.pending')
    try:
        temporary.write_bytes(raw)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def copy_exact(source, target):
    """原字节复制；重跑时相同内容不重写，完成后核对 SHA-256。"""
    digest = sha(source)
    if source.resolve() == target.resolve():
        raise ValueError('输出不能覆盖归档原文件')
    if not target.exists() or sha(target) != digest:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + '.pending')
        try:
            shutil.copyfile(source, temporary)
            if sha(temporary) != digest:
                raise ValueError(f'复制校验失败：{source.name}')
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    if sha(target) != digest:
        raise ValueError(f'输出校验失败：{target.name}')
    return {'bytes': target.stat().st_size, 'sha256': digest}


def tile_path(tile):
    path = PurePosixPath(tile['url'])
    if (path.parts[:3] != ('/', 'data', 'tiles') or len(path.parts) != 4
            or path.name != tile['id'] + '.json' or '..' in path.parts):
        raise ValueError(f'不是预期的本地建筑分片地址：{tile["url"]}')
    return Path('tiles') / path.name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-dir', type=Path, default=TASK / 'work/archive-geodata')
    parser.add_argument('--map', type=Path, default=REPO / 'public/data/shenzhen-map.json')
    parser.add_argument('--public-data', type=Path, default=REPO / 'public/data')
    args = parser.parse_args()
    archive = args.archive_dir.resolve()
    output = args.public_data.resolve()
    if output == archive or archive in output.parents:
        raise ValueError('恢复目标不能位于归档目录内')
    city_path, terrain_path = archive / 'city.json', archive / 'city-terrain.json'
    city, light = read(city_path), read(args.map)
    archive_statistics = read(archive / 'city-statistics.json')
    archive_validation = read(archive / 'city-validation.json')
    terrain_mesh = read(terrain_path)
    if city['bounds'] != light['bounds'] or city['center'] != light['center']:
        raise ValueError('城市档案与修正版底图的范围或中心不同')
    if light['version'] != 1 or len({d['name'] for d in light['districts']}) != 10 or len(light['landmarks']) != 5:
        raise ValueError('修正版区界与地标不完整')
    repair = light['statistics']['districtRepair']
    if repair['longgangEqualsDapeng'] or repair['overlapAreaDegrees'] != 0:
        raise ValueError('修正版区界仍含已知的龙岗/大鹏重复问题')
    if light['statistics']['inputCitySha256'] != sha(city_path):
        raise ValueError('修正版地标所依据的城市档案与本次输入不同')
    terrain = city['terrain']
    if (terrain['bounds'] != city['bounds'] or len(terrain['values']) != terrain['width'] * terrain['height']
            or not all(math.isfinite(value) for value in terrain['values'])):
        raise ValueError('粗高程网格不完整')
    if (terrain_mesh['bounds'] != city['bounds'] or len(terrain_mesh['positions']) % 9
            or len(terrain_mesh['positions']) // 9 != terrain_mesh['statistics']['triangles']
            or terrain_mesh['coordinateSystem'] != 'WGS84' or terrain_mesh['heightDatum'] != 'EGM2008'
            or not all(math.isfinite(value) for value in terrain_mesh['positions'])):
        raise ValueError('裁切地形格式与来源契约不符')

    tiles = city['buildingTiles']
    if len({tile['id'] for tile in tiles}) != len(tiles) or len({tile['url'] for tile in tiles}) != len(tiles):
        raise ValueError('建筑分片索引有重复标识或地址')
    tile_bytes = detail_roads = buildings = 0
    heights = collections.Counter()
    # 全部分片先检查，再将主索引作为最后一个文件写入。
    for tile in tiles:
        source = archive / tile_path(tile)
        data = read(source)
        if len(data['buildings']) != tile['count'] or not isinstance(data['roads'], list):
            raise ValueError(f'分片数量与索引不符：{tile["id"]}')
        tile_bytes += source.stat().st_size
        buildings += len(data['buildings'])
        detail_roads += len(data['roads'])
        heights.update(building['heightSource'] for building in data['buildings'])
    if (buildings != archive_statistics['buildings']['buildings']
            or detail_roads != archive_statistics['osm']['roadLOD']['detail']
            or tile_bytes != archive_statistics['tileBytes']
            or len(tiles) != archive_statistics['tiles']):
        raise ValueError('分片总量与原始统计不符')
    if any(heights[key] != archive_statistics['buildings'][key] for key in heights):
        raise ValueError('建筑高度来源统计与档案不符')

    restored = dict(city)
    restored.update(version=1, districts=light['districts'], landmarks=light['landmarks'], generated=DATE)
    # 保留全部实际图层来源，再补入修正版地标的官方署名入口。
    restored['sources'] = list({source['url']: source for source in [*light['sources'], *city['sources']]}.values())
    restored['statistics'] = {
        'coordinateSystem': 'WGS84',
        'projection': light['statistics']['projection'],
        'osmTimestamp': light['statistics']['osmTimestamp'],
        'overtureRelease': light['statistics']['overtureRelease'],
        'counts': {
            'land': len(city['land']), 'water': len(city['water']), 'roads': len(city['roads']),
            'overviewBuildings': len(city['buildings']), 'buildingPolygons': buildings,
            'buildingTiles': len(tiles), 'detailRoads': detail_roads,
            'districtPolygons': len(light['districts']), 'districtNames': 10, 'landmarks': len(light['landmarks']),
            'terrainSamples': len(terrain['values']), 'terrainTriangles': len(terrain_mesh['positions']) // 9,
        },
        'districtSources': light['statistics']['districtSources'],
        'districtRepair': repair,
        'landmarkSources': light['statistics']['landmarkSources'],
        'archiveStatistics': archive_statistics,
        'archiveValidation': archive_validation,
        'restoration': {
            'inputCitySha256': sha(city_path), 'inputLightMapSha256': sha(args.map),
            'inputTerrainSha256': sha(terrain_path),
            'inputStatisticsSha256': sha(archive / 'city-statistics.json'),
            'inputValidationSha256': sha(archive / 'city-validation.json'),
            'unchangedLayers': list(UNCHANGED_LAYERS), 'replacementLayers': ['districts', 'landmarks'],
            'terrainUrl': '/data/city-terrain.json', 'terrainBytes': terrain_path.stat().st_size,
            'tileBytes': tile_bytes, 'heightSources': dict(sorted(heights.items())),
            'routeGeometryModified': False,
        },
    }
    if any(restored[key] != city[key] for key in UNCHANGED_LAYERS):
        raise ValueError('恢复过程意外改变了原始城市图层')
    for tile in tiles:
        relative = tile_path(tile)
        copy_exact(archive / relative, output / relative)
    terrain_result = copy_exact(terrain_path, output / 'city-terrain.json')
    raw = encoded(restored)
    target = output / 'shenzhen-city.json'
    if target.resolve() == args.map.resolve():
        raise ValueError('主索引输出不能覆盖轻量快照')
    atomic_write(target, raw)
    print(json.dumps({
        'cityBytes': len(raw), 'citySha256': sha(target), 'counts': restored['statistics']['counts'],
        'terrain': terrain_result, 'tileBytes': tile_bytes,
        'totalRestoredBytes': len(raw) + terrain_result['bytes'] + tile_bytes,
        'validation': {'preservedCityLayers': list(UNCHANGED_LAYERS), 'correctedLayersMatchLightMap': True,
                       'tilesByteVerified': len(tiles), 'terrainByteVerified': True},
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
