import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

describe('GitHub workflows', () => {
  it('defines PR validation without live browser collection', async () => {
    const text = await readFile(path.join(process.cwd(), '.github', 'workflows', 'pr-validation.yml'), 'utf8');
    expect(() => parse(text)).not.toThrow();
    for (const command of [
      'npm ci',
      'npm run typecheck',
      'npm run product:check',
      'npm run schema:check',
      'npm test',
      'npm run collect:fixture',
      'npm run local:scheduler -- --once --fixture --dry-run --now=2026-08-14T00:00:00.000Z',
      'npm run local:install -- --dry-run',
    ]) expect(text).toContain(command);
    expect(text).not.toContain('collect:browser');
    expect(text).not.toContain('spike:opencli');
    expect(text).not.toContain('local:morning');
    expect(text).not.toContain('--install');
    expect(text).not.toContain('OPENAI_API_KEY');
    expect(text).not.toContain('openai');
    expect(text).not.toContain('launchctl');
  });

  it('keeps the hosted daily workflow cloud-only', async () => {
    const text = await readFile(path.join(process.cwd(), '.github', 'workflows', 'daily-material-collection.yml'), 'utf8');
    expect(() => parse(text)).not.toThrow();
    expect(text).toContain('npm run collect:cloud');
    expect(text).not.toContain('collect:browser');
    expect(text).not.toContain('local:scheduler');
  });
});
