import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z, type ZodType } from 'zod';
import { contentFitProfileSchema } from '../src/product/content-fit-profile.js';
import { productProfileSchema } from '../src/product/product-profile.js';
import { materialSchema, unifiedMaterialSchema } from '../src/types.js';
import { topicDecisionSchema } from '../src/topic-intelligence/schemas.js';

const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const schemas = [
  {
    filename: 'topic-decision.schema.json',
    id: 'https://example.local/schemas/topic-decision.schema.json',
    title: 'Daily Topic Intelligence Decision',
    schema: topicDecisionSchema,
  },
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
  {
    filename: 'product-profile.schema.json',
    id: 'https://example.local/schemas/product-profile.schema.json',
    title: 'AI Never Fall Behind Product Profile',
    schema: productProfileSchema,
  },
  {
    filename: 'content-fit-profile.schema.json',
    id: 'https://example.local/schemas/content-fit-profile.schema.json',
    title: 'AI Never Fall Behind Content Fit Profile',
    schema: contentFitProfileSchema,
  },
] satisfies Array<{ filename: string; id: string; title: string; schema: ZodType }>;

function serializeSchema(schema: ZodType, id: string, title: string): string {
  const generated = z.toJSONSchema(schema);
  if (generated.$schema !== JSON_SCHEMA_DRAFT) {
    throw new Error(`Unexpected JSON Schema draft: ${String(generated.$schema)}`);
  }
  const { $schema: _generatedDraft, ...body } = generated;
  const document: Record<string, unknown> = {
    $schema: JSON_SCHEMA_DRAFT,
    $id: id,
    title,
    ...body,
  };
  if (title === 'Daily Topic Intelligence Decision') {
    document.allOf = [
      {
        if: { properties: { status: { const: 'success' }, decision: { const: 'SELECT_TOPIC' } }, required: ['status', 'decision'] },
        then: { properties: { selected_topic: { not: { type: 'null' } } }, required: ['selected_topic'] },
      },
      {
        if: { properties: { status: { const: 'success' }, decision: { const: 'NO_PUBLISH' } }, required: ['status', 'decision'] },
        then: {
          properties: {
            selected_topic: { type: 'null' },
            no_publish_reason_code: { not: { type: 'null' } },
            no_publish_reason: { type: 'string', minLength: 1 },
          },
          required: ['selected_topic', 'no_publish_reason_code', 'no_publish_reason'],
        },
      },
      {
        if: { properties: { status: { const: 'failed' } }, required: ['status'] },
        then: {
          properties: {
            decision: { type: 'null' },
            selected_topic: { type: 'null' },
            error_code: { not: { type: 'null' } },
          },
          required: ['decision', 'selected_topic', 'error_code'],
        },
      },
    ];
  }
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
