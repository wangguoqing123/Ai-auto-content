import { copyFile, mkdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const source = path.join(rootDir, 'opencli-adapters', 'twitter', 'search-rich.js');
const destinationDirectory = path.join(os.homedir(), '.opencli', 'clis', 'twitter');
const destination = path.join(destinationDirectory, 'search-rich.js');
const temporary = `${destination}.tmp-${process.pid}`;

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, temporary);
await rename(temporary, destination);
console.log(JSON.stringify({ installed: true, source, destination }, null, 2));
