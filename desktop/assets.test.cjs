const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { createAssetHandler } = require('./assets.cjs');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shenzhen-desktop-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'site');
  await mkdir(join(root, 'prototype', 'delivery'), { recursive: true });
  await mkdir(join(root, 'data'));
  const html = '<!doctype html><html lang="zh-CN"><title>外卖专注</title></html>';
  const data = '{"名称":"深圳湾","坐标":[113.94,22.52]}';
  await writeFile(join(root, 'prototype', 'delivery.html.gz'), gzipSync(html));
  await writeFile(join(root, 'prototype', 'delivery', 'index.txt'), '这是RSC目录，不能作为页面');
  await writeFile(join(root, 'data', 'city.json.gz'), gzipSync(data));
  const protectedFile = join(directory, 'protected.txt');
  await writeFile(protectedFile, '此文件不得通过本地协议读出');
  return { handle: createAssetHandler(root), html, data, protectedFile };
}

test('压缩资源能按原地址读取，同名RSC目录不会盖住页面', async t => {
  const { handle, html, data } = await fixture(t);
  const page = await handle(new Request('shenzhen://app/prototype/delivery?mode=demo'));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('content-encoding'), null);
  assert.equal(await page.text(), html);
  const json = await handle(new Request('shenzhen://app/data/city.json'));
  assert.equal(json.status, 200);
  assert.equal(await json.text(), data);
  const head = await handle(new Request('shenzhen://app/data/city.json', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('本地协议拒绝越界、外域和写入请求，缺失资源返回404', async t => {
  const { handle, protectedFile } = await fixture(t);
  const rejected = [
    new Request('shenzhen://app/%2e%2e%2fprotected.txt'),
    new Request('shenzhen://other/data/city.json'),
    new Request(pathToFileURL(protectedFile)),
  ];
  for (const request of rejected) {
    const response = await handle(request);
    assert.ok(response.status >= 400, request.url);
    assert.notEqual(await response.text(), '此文件不得通过本地协议读出');
  }
  const post = await handle(new Request('shenzhen://app/data/city.json', { method: 'POST', body: '修改' }));
  assert.equal(post.status, 405);
  const missing = await handle(new Request('shenzhen://app/not-present.bin'));
  assert.equal(missing.status, 404);
  assert.equal(await readFile(protectedFile, 'utf8'), '此文件不得通过本地协议读出');
});
