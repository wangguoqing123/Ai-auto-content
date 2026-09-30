import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexStructuredOutputError,
  CodexStructuredRunner,
} from '../src/local-agent/codex-structured-runner.js';
import { simpleWriterOutputSchema } from '../src/simple-writing/schemas.js';

const roots: string[] = [];
const fakeCodex = path.join(process.cwd(), 'tests', 'fixtures', 'fake-codex.mjs');
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function createRunner(model: string, maxOutputBytes = 2 * 1024 * 1024) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-structured-runner-'));
  roots.push(root);
  return CodexStructuredRunner.create({
    binPath: fakeCodex,
    model,
    tempRoot: path.join(root, 'calls'),
    maxOutputBytes,
    env: { HOME: os.homedir(), PATH: process.env.PATH, LANG: 'en_US.UTF-8', TERM: 'dumb' },
  });
}

async function run(model: string, maxOutputBytes?: number) {
  const runner = await createRunner(model, maxOutputBytes);
  return runner.run({
    label: 'simple-writing-test',
    input: { materials: [{ material_id: 'mat_111111111111' }] },
    systemInstructions: 'Return the requested synthetic Simple Writing output.',
    outputSchema: simpleWriterOutputSchema,
  });
}

async function outputError(model: string, maxOutputBytes?: number): Promise<CodexStructuredOutputError> {
  try {
    await run(model, maxOutputBytes);
    throw new Error('expected CodexStructuredOutputError');
  } catch (error) {
    expect(error).toBeInstanceOf(CodexStructuredOutputError);
    return error as CodexStructuredOutputError;
  }
}

describe('Codex Structured Runner output parsing', () => {
  it.each([
    ['fake-simple-writing-fenced', '```'],
    ['fake-simple-writing-tilde', '~~~'],
  ])('accepts valid JSON when article_markdown contains %s content', async (model, marker) => {
    const result = await run(model);
    expect(result.output.article_markdown).toContain(marker);
  });

  it('rejects top-level fenced JSON without extracting it', async () => {
    expect((await outputError('fake-simple-writing-top-fence')).safeDiagnostic).toBe('markdown_wrapper');
  });

  it('distinguishes invalid JSON', async () => {
    expect((await outputError('fake-invalid-json')).safeDiagnostic).toBe('invalid_json');
  });

  it('reports only the Schema path and issue code', async () => {
    const diagnostic = (await outputError('fake-simple-writing-schema-invalid')).safeDiagnostic;
    expect(diagnostic).toBe('schema_validation_failed:primary_title:too_big');
    expect(diagnostic?.length).toBeLessThanOrEqual(500);
  });

  it('distinguishes a missing result file', async () => {
    expect((await outputError('fake-result-missing')).safeDiagnostic).toBe('result_missing');
  });

  it('distinguishes an oversized result file', async () => {
    expect((await outputError('fake-large', 64 * 1024)).safeDiagnostic).toBe('result_too_large');
  });

  it('distinguishes process output overflow', async () => {
    expect((await outputError('fake-output-limit', 64 * 1024)).safeDiagnostic).toBe('output_limit_exceeded');
  });

  it('distinguishes a structured-output process failure', async () => {
    expect((await outputError('fake-schema-exit')).safeDiagnostic).toBe('structured_output_process_failed');
  });
});
