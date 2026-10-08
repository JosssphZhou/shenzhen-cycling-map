"""从公开 OSM PBF 留存真实路网，供路线人工选择与可重复核验。"""
import json
import pathlib
import sys
import osmium

class RoutesHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes = {}
        self.ways = {}
        self.places = []
        self.relations = []

    @staticmethod
    def inside(lon, lat):
        return 113.74 <= lon <= 114.65 and 22.43 <= lat <= 22.88

    def node(self, node):
        tags = dict(node.tags)
        if tags.get('name') and node.location.valid() and self.inside(node.location.lon, node.location.lat):
            self.places.append({'type': 'node', 'id': node.id, 'name': tags['name'],
                                'coordinate': [node.location.lon, node.location.lat], 'tags': tags})

    def way(self, way):
        tags = dict(way.tags)
        if not (tags.get('highway') or tags.get('name')):
            return
        refs = list(way.nodes)
        if not refs or not all(n.location.valid() for n in refs):
            return
        if not any(self.inside(n.location.lon, n.location.lat) for n in refs):
            return
        if tags.get('name'):
            mid = refs[len(refs)//2]
            self.places.append({'type': 'way', 'id': way.id, 'name': tags['name'],
                                'coordinate': [mid.location.lon, mid.location.lat], 'tags': tags})
        if tags.get('highway'):
            self.ways[str(way.id)] = {'id': way.id, 'nodes': [n.ref for n in refs], 'tags': tags}
            for n in refs:
                self.nodes[str(n.ref)] = [n.location.lon, n.location.lat]

    def relation(self, relation):
        tags = dict(relation.tags)
        if tags.get('route') == 'bicycle':
            self.relations.append({'id': relation.id, 'tags': tags,
                'members': [{'type': m.type, 'ref': m.ref, 'role': m.role} for m in relation.members]})

if __name__ == '__main__':
    handler = RoutesHandler()
    handler.apply_file(sys.argv[1], locations=True, filters=[osmium.filter.KeyFilter('highway', 'name', 'route')])
    out = pathlib.Path(sys.argv[2])
    out.write_text(json.dumps({'source': 'https://download.geofabrik.de/asia/china/guangdong.html',
        'checked': '2026-10-08', 'nodes': handler.nodes, 'ways': handler.ways,
        'places': handler.places, 'relations': handler.relations}, ensure_ascii=False), encoding='utf-8')
    print(f'提取 {len(handler.ways)} 条道路、{len(handler.nodes)} 个道路节点、{len(handler.places)} 个具名地点。')
