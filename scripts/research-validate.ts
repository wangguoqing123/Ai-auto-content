import { readFile } from 'node:fs/promises';
import { researchPackSchema } from '../src/research/schemas.js';

const filePath = process.argv[2];
if (!filePath) throw new Error('Expected a Research Pack path');
researchPackSchema.parse(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
process.stdout.write(`Research Pack valid: ${filePath}\n`);
