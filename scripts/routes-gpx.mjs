import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'lib/gpx.ts'), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createGpx } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const routes = JSON.parse(await fs.readFile(path.join(root, 'public/data/routes.json'), 'utf8'));
await fs.mkdir(path.join(root, 'public/tracks'), { recursive: true });
for (const route of routes.filter((item) => item.exportable)) {
  await fs.writeFile(path.join(root, 'public/tracks', `${route.id}.gpx`), createGpx(route));
}
console.log(`已生成 ${routes.filter((route) => route.exportable).length} 条原始坐标 GPX。`);
