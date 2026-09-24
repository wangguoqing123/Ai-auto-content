import { readFile } from 'node:fs/promises';
import { writingPackSchema } from '../src/writing/schemas.js';

const filename = process.argv[2];
if (filename === undefined || filename.startsWith('--')) throw new Error('Expected a Writing Pack path');
writingPackSchema.parse(JSON.parse(await readFile(filename, 'utf8')) as unknown);
process.stdout.write(`Writing Pack valid: ${filename}\n`);
