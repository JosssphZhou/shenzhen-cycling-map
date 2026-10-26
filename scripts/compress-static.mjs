import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const root = resolve(process.argv[2] || 'out');
const compress = promisify(gzip);
const extensions = /\.(?:html|js|css|json|svg|txt|bin)$/;
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(directory, entry.name))
    : extensions.test(entry.name) ? [join(directory, entry.name)] : []))).flat();
}
const pending = await files(root);
let count = 0, rawBytes = 0, encodedBytes = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (pending.length) {
    const path = pending.pop();
    const info = await stat(path);
    if (info.size < 1024) continue;
    const input = await readFile(path);
    const output = await compress(input, { level: 9 });
    if (output.byteLength + 128 >= input.byteLength) {
      await unlink(path + '.gz').catch(error => { if (error.code !== 'ENOENT') throw error; });
      continue;
    }
    await writeFile(path + '.gz', output);
    count++; rawBytes += input.byteLength; encodedBytes += output.byteLength;
  }
}));
console.log(JSON.stringify({ compressedAssets: count, rawBytes, encodedBytes }));
