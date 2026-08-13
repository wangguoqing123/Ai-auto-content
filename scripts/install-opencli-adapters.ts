import { copyFile, mkdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const adapters = [
  { site: 'twitter', file: 'search-rich.js' },
  { site: 'weixin', file: 'resolve-article-url.js' },
];
const installed = [];

for (const adapter of adapters) {
  const source = path.join(rootDir, 'opencli-adapters', adapter.site, adapter.file);
  const destinationDirectory = path.join(os.homedir(), '.opencli', 'clis', adapter.site);
  const destination = path.join(destinationDirectory, adapter.file);
  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(destinationDirectory, { recursive: true });
  await copyFile(source, temporary);
  await rename(temporary, destination);
  installed.push({ source, destination });
}

console.log(JSON.stringify({ installed: true, adapters: installed }, null, 2));
