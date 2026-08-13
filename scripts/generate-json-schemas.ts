import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z, type ZodType } from 'zod';
import { materialSchema, unifiedMaterialSchema } from '../src/types.js';

const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const schemas = [
  {
    filename: 'unified-material.schema.json',
    id: 'https://example.local/schemas/unified-material.schema.json',
    title: 'Unified Material',
    schema: unifiedMaterialSchema,
  },
  {
    filename: 'material-card.schema.json',
    id: 'https://example.local/schemas/material-card.schema.json',
    title: 'Daily Material Record',
    schema: materialSchema,
  },
] satisfies Array<{ filename: string; id: string; title: string; schema: ZodType }>;

function serializeSchema(schema: ZodType, id: string, title: string): string {
  const generated = z.toJSONSchema(schema);
  if (generated.$schema !== JSON_SCHEMA_DRAFT) {
    throw new Error(`Unexpected JSON Schema draft: ${String(generated.$schema)}`);
  }
  const { $schema: _generatedDraft, ...body } = generated;
  const document = {
    $schema: JSON_SCHEMA_DRAFT,
    $id: id,
    title,
    ...body,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function generateInto(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(schemas.map(async ({ filename, id, title, schema }) => {
    await writeFile(path.join(outputDirectory, filename), serializeSchema(schema, id, title), 'utf8');
  }));
}

async function checkCommittedSchemas(repositoryRoot: string): Promise<void> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'ai-auto-content-schemas-'));
  try {
    await generateInto(temporaryDirectory);
    const mismatches: string[] = [];
    for (const { filename } of schemas) {
      const generated = await readFile(path.join(temporaryDirectory, filename), 'utf8');
      const committed = await readFile(path.join(repositoryRoot, 'schemas', filename), 'utf8');
      if (generated !== committed) mismatches.push(filename);
    }
    if (mismatches.length > 0) {
      throw new Error(`JSON Schema drift detected: ${mismatches.join(', ')}. Run npm run schema:generate.`);
    }
    console.log(`JSON Schema check passed (${schemas.length} files).`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const repositoryRoot = process.cwd();
if (process.argv.includes('--check')) {
  await checkCommittedSchemas(repositoryRoot);
} else {
  await generateInto(path.join(repositoryRoot, 'schemas'));
  console.log(`Generated ${schemas.length} JSON Schema files.`);
}
