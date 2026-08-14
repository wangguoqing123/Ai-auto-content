import { readFile } from 'node:fs/promises';
import { topicDecisionSchema } from '../src/topic-intelligence/schemas.js';

const filePath = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
if (filePath === undefined) {
  console.error('Usage: npm run topic:validate -- <decision-file>');
  process.exitCode = 1;
} else {
  try {
    topicDecisionSchema.parse(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
    console.log(`Valid topic decision: ${filePath}`);
  } catch {
    console.error('Invalid topic decision schema.');
    process.exitCode = 4;
  }
}
