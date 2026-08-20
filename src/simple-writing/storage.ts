import { chmod, lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertNoSymlinkComponents,
  assertResolvedPathOutsideRepository,
  secureAtomicWrite,
} from '../style-intelligence/safe-local-path.js';
import type { SimpleWritingInput, SimpleWritingMaterial } from './input.js';
import { simpleWritingPackSchema, type SimpleWritingPack } from './schemas.js';

export interface SimpleWritingOutputFiles {
  article: string;
  sources: string;
  reviewNotes: string;
  pack: string;
}

export async function resolveSimpleWritingOutputDirectory(options: {
  writingDate: string;
  dryRun: boolean;
  outputRoot?: string;
}): Promise<string> {
  if (options.outputRoot !== undefined) {
    return options.dryRun
      ? path.resolve(options.outputRoot)
      : path.join(path.resolve(options.outputRoot), options.writingDate);
  }
  if (options.dryRun) {
    return mkdtemp(path.join('/tmp', `ai-auto-content-simple-writing-${Date.now()}-`));
  }
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'AiAutoContent',
    'simple-writing',
    options.writingDate,
  );
}

export async function ensurePrivateOutputDirectory(
  directory: string,
  repositoryRoot: string,
): Promise<string> {
  const requested = path.resolve(directory);
  await assertNoSymlinkComponents(path.dirname(requested), true);
  await assertResolvedPathOutsideRepository(requested, repositoryRoot);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await lstat(requested);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('simple_writing_output_directory_invalid');
  await assertNoSymlinkComponents(requested);
  const resolved = await realpath(requested);
  await assertResolvedPathOutsideRepository(resolved, repositoryRoot);
  await chmod(resolved, 0o700);
  return resolved;
}

function renderArticle(pack: SimpleWritingPack): string {
  const output = pack.output;
  if (output === null) throw new Error('simple_writing_output_missing');
  const [firstAlternative, secondAlternative] = output.alternative_titles;
  if (firstAlternative === undefined || secondAlternative === undefined) throw new Error('simple_writing_titles_missing');
  return `# ${output.primary_title}

## 备用标题

- ${firstAlternative}
- ${secondAlternative}

## 摘要

${output.abstract}

## 正文

${output.article_markdown.trim()}
`;
}

function renderSources(materials: SimpleWritingMaterial[]): string {
  const sections = materials.map((material) => `## ${material.title}

- 素材 ID：${material.material_id}
- 来源：${material.source_name}（${material.source_type}）
- 发布时间：${material.published_at ?? '未知'}
- 原始链接：${material.canonical_url}
- 内容范围：${material.content_scope}
- 来源状态：${material.source_status}`);
  return `# 本次使用的素材

${sections.join('\n\n')}
`;
}

function listOrNone(values: string[]): string {
  return values.length === 0 ? '- 无' : values.map((value) => `- ${value}`).join('\n');
}

function renderReviewNotes(pack: SimpleWritingPack): string {
  const output = pack.output;
  const warnings = pack.checks?.warnings.map(({ category, code, message }) => `[${category}/${code}] ${message}`) ?? [];
  return `# 人工审核说明

## 资料不足或不确定点

${listOrNone(output?.uncertain_points ?? [])}

## Writer 留给人工的说明

${listOrNone(output?.human_review_notes ?? [])}

## 代码检查 Warnings

${listOrNone(warnings)}

> 这是 AI 生成草稿，尚未发布，请人工检查事实、表达、标题和引用来源。
`;
}

export async function writeSimpleWritingSuccessFiles(options: {
  repositoryRoot: string;
  outputDirectory: string;
  input: SimpleWritingInput;
  pack: SimpleWritingPack;
}): Promise<SimpleWritingOutputFiles> {
  const pack = simpleWritingPackSchema.parse(options.pack);
  if (pack.decision !== 'READY_FOR_HUMAN_REVIEW' || pack.output === null || pack.checks === null
    || pack.checks.hard_failures.length > 0) {
    throw new Error('simple_writing_pack_not_ready');
  }
  const outputDirectory = await ensurePrivateOutputDirectory(options.outputDirectory, options.repositoryRoot);
  const usedIds = new Set(pack.output.used_source_ids);
  const sources = options.input.materials.filter(({ material_id }) => usedIds.has(material_id));
  const files: SimpleWritingOutputFiles = {
    article: path.join(outputDirectory, 'article.md'),
    sources: path.join(outputDirectory, 'sources.md'),
    reviewNotes: path.join(outputDirectory, 'review-notes.md'),
    pack: path.join(outputDirectory, 'simple-writing-pack.json'),
  };
  await Promise.all([
    secureAtomicWrite(files.article, renderArticle(pack)),
    secureAtomicWrite(files.sources, renderSources(sources)),
    secureAtomicWrite(files.reviewNotes, renderReviewNotes(pack)),
    secureAtomicWrite(files.pack, `${JSON.stringify(pack, null, 2)}\n`),
  ]);
  return files;
}
