import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

describe('GitHub workflows', () => {
  it('defines PR validation without live browser collection', async () => {
    const text = await readFile(path.join(process.cwd(), '.github', 'workflows', 'pr-validation.yml'), 'utf8');
    expect(() => parse(text)).not.toThrow();
    for (const command of ['npm ci', 'npm run typecheck', 'npm test', 'npm run collect:fixture']) expect(text).toContain(command);
    expect(text).not.toContain('collect:browser');
    expect(text).not.toContain('spike:opencli');
  });

  it('keeps the hosted daily workflow cloud-only', async () => {
    const text = await readFile(path.join(process.cwd(), '.github', 'workflows', 'daily-material-collection.yml'), 'utf8');
    expect(() => parse(text)).not.toThrow();
    expect(text).toContain('npm run collect:cloud');
    expect(text).not.toContain('collect:browser');
  });
});
