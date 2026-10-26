import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);
const electron = require('electron/package.json'), project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const source = join(root, 'out'), output = join(root, 'desktop-dist'), name = '深圳骑行地图';
if (process.platform !== 'darwin') throw new Error('这份macOS体验包需要在Mac上打包。');
await stat(join(source, 'prototype', 'delivery.html')).catch(() => { throw new Error('没有找到已构建的体验页面，请先准备out静态导出。'); });
await stat(join(dirname(require.resolve('electron/package.json')), 'dist', 'Electron.app')).catch(() => { throw new Error('Electron运行时尚未安装完成，请先运行node node_modules/electron/install.js。'); });
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, '.stage-'));

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`静态资源中存在不支持的文件类型：${relative(source, path)}`);
  }
  return result;
}
async function digest(path, compressed = false) {
  const source = createReadStream(path), stream = compressed ? source.pipe(createGunzip()) : source;
  if (compressed) source.on('error', error => stream.destroy(error));
  const hash = createHash('sha256'); let bytes = 0;
  try { for await (const chunk of stream) { hash.update(chunk); bytes += chunk.length; } }
  finally { source.destroy(); if (stream !== source) stream.destroy(); }
  return { bytes, sha256: hash.digest('hex') };
}

try {
  const paths = await files(source), available = new Set(paths);
  const logical = paths.filter(path => !path.endsWith('.gz') || !available.has(path.slice(0, -3)));
  const assets = [], queue = [...logical];
  console.log(`正在收集${logical.length}份离线资源…`);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const path = queue.pop(), compressed = available.has(path + '.gz'), physical = compressed ? path + '.gz' : path;
      const logicalPath = relative(source, path).split(sep).join('/'), storedPath = relative(source, physical).split(sep).join('/');
      const content = await digest(path), stored = await stat(physical);
      if (compressed) {
        const decoded = await digest(physical, true);
        if (decoded.bytes !== content.bytes || decoded.sha256 !== content.sha256) throw new Error(`压缩副本与原资源不同：${logicalPath}`);
      }
      const target = join(staging, 'site', storedPath); await mkdir(dirname(target), { recursive: true }); await copyFile(physical, target);
      assets.push({ path: logicalPath, storedPath, storage: compressed ? 'gzip' : 'raw', logicalBytes: content.bytes, storedBytes: stored.size, sha256: content.sha256 });
    }
  }));
  assets.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  let revision = null;
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
  const manifest = {
    version: 1, appName: name, appVersion: project.version, electronVersion: electron.version, sourceRevision: revision,
    entry: 'shenzhen://app/prototype/delivery',
    totals: { logicalFiles: assets.length, logicalBytes: assets.reduce((sum, asset) => sum + asset.logicalBytes, 0), storedFiles: assets.length, storedBytes: assets.reduce((sum, asset) => sum + asset.storedBytes, 0), gzipFiles: assets.filter(asset => asset.storage === 'gzip').length },
    assets,
  };
  await writeFile(join(staging, 'resources.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(staging, 'package.json'), JSON.stringify({ name: 'shenzhen-delivery-desktop', productName: name, version: project.version, private: true, main: 'main.cjs', description: project.description }, null, 2) + '\n');
  for (const file of ['main.cjs', 'assets.cjs', 'preload.cjs']) await copyFile(join(root, 'desktop', file), join(staging, file));
  await copyFile(join(root, 'docs', '来源与许可.md'), join(staging, '来源与许可.md'));
  console.log(`资源已核对，使用Electron ${electron.version}打包${process.arch}应用…`);
  const pathsOut = await packager({
    dir: staging, out: output, name, executableName: name, appBundleId: 'studio.shenzhen.delivery',
    appVersion: project.version, buildVersion: project.version, platform: 'darwin', arch: process.arch,
    electronVersion: electron.version, overwrite: true, asar: true, prune: false,
    osxSign: { identity: '-', identityValidation: false, type: 'development', preAutoEntitlements: false, preEmbedProvisioningProfile: false, optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }) },
    extendInfo: { CFBundleDisplayName: name, CFBundleName: name, LSApplicationCategoryType: 'public.app-category.productivity', NSHighResolutionCapable: true },
  });
  await writeFile(join(output, 'resource-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ applications: pathsOut.map(path => join(path, `${name}.app`)), signing: 'ad-hoc', notarized: false, resources: manifest.totals }, null, 2));
} finally { await rm(staging, { recursive: true, force: true }); }
