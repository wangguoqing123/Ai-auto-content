import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { profileTypeSchema, rightsStatusSchema } from './schemas.js';
import { sha256, stableJson } from './hash.js';
import type { CorpusDocument, CorpusImportOptions } from './types.js';

const corpusDirectories = ['owner', 'references', 'feedback', 'cache'] as const;

interface CorpusSourceEntry {
  profile_id: string;
  profile_type: CorpusDocument['profile_type'];
  rights_status: CorpusDocument['rights_status'];
  platform: string;
  content_type: string;
  document_files: string[];
  imported_at: string;
}

interface CorpusRegistry {
  version: 1;
  sources: CorpusSourceEntry[];
}

export function defaultStyleCorpusRoot(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, 'Library', 'Application Support', 'AiAutoContent', 'style-corpus');
}

export function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertCorpusOutsideRepository(corpusRoot: string, repositoryRoot = process.cwd()): void {
  if (pathIsInside(repositoryRoot, corpusRoot)) throw new Error('style_corpus_must_be_outside_repository');
}

async function secureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function secureWrite(filename: string, content: string): Promise<void> {
  await writeFile(filename, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600);
}

export async function ensureStyleCorpus(corpusRoot = defaultStyleCorpusRoot()): Promise<void> {
  assertCorpusOutsideRepository(corpusRoot);
  await secureDirectory(corpusRoot);
  for (const directory of corpusDirectories) await secureDirectory(path.join(corpusRoot, directory));
  const registryPath = path.join(corpusRoot, 'sources.local.yaml');
  try {
    await lstat(registryPath);
    await chmod(registryPath, 0o600);
  } catch {
    await secureWrite(registryPath, YAML.stringify({ version: 1, sources: [] } satisfies CorpusRegistry));
  }
}

export async function inspectCorpusPermissions(corpusRoot: string): Promise<{ directories_secure: boolean; files_secure: boolean }> {
  const directoryModes = await Promise.all([corpusRoot, ...corpusDirectories.map((directory) => path.join(corpusRoot, directory))]
    .map(async (directory) => (await lstat(directory)).mode & 0o777));
  const files: string[] = [path.join(corpusRoot, 'sources.local.yaml')];
  for (const directory of corpusDirectories) {
    for (const entry of await readdir(path.join(corpusRoot, directory), { withFileTypes: true })) {
      if (entry.isFile()) files.push(path.join(corpusRoot, directory, entry.name));
    }
  }
  const fileModes = await Promise.all(files.map(async (filename) => (await lstat(filename)).mode & 0o777));
  return { directories_secure: directoryModes.every((mode) => mode === 0o700), files_secure: fileModes.every((mode) => mode === 0o600) };
}

async function parseSourceDocuments(sourcePath: string): Promise<Array<{ title: string; text: string }>> {
  const extension = path.extname(sourcePath).toLocaleLowerCase();
  const raw = await readFile(sourcePath, 'utf8');
  if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
    const heading = raw.match(/^#\s+(.+)$/mu)?.[1]?.trim();
    return [{ title: heading ?? path.basename(sourcePath, extension), text: raw.trim() }];
  }
  if (extension === '.jsonl') {
    return raw.split(/\r?\n/u).filter((line) => line.trim() !== '').map((line, index) => {
      const value = JSON.parse(line) as unknown;
      if (typeof value === 'string') return { title: `${path.basename(sourcePath)} ${index + 1}`, text: value.trim() };
      if (value === null || typeof value !== 'object') throw new Error(`Invalid JSONL document at line ${index + 1}`);
      const record = value as Record<string, unknown>;
      if (typeof record.text !== 'string' || record.text.trim() === '') throw new Error(`Missing text at JSONL line ${index + 1}`);
      return { title: typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : `${path.basename(sourcePath)} ${index + 1}`, text: record.text.trim() };
    });
  }
  throw new Error('style_import_supports_markdown_text_or_jsonl_only');
}

export async function importCorpusDocuments(options: CorpusImportOptions): Promise<CorpusDocument[]> {
  assertCorpusOutsideRepository(options.corpusRoot);
  if (pathIsInside(process.cwd(), options.sourcePath)) throw new Error('style_source_must_be_outside_repository');
  await ensureStyleCorpus(options.corpusRoot);
  const profileType = profileTypeSchema.parse(options.profileType);
  const rightsStatus = rightsStatusSchema.parse(options.rightsStatus);
  if (rightsStatus === 'public_reference' && profileType !== 'reference_technique') throw new Error('public_reference_requires_reference_technique');
  const importedAt = options.importedAt ?? new Date().toISOString();
  const parsed = await parseSourceDocuments(options.sourcePath);
  if (parsed.length === 0) throw new Error('style_source_contains_no_documents');
  const targetDirectory = profileType === 'owner_voice' ? 'owner' : 'references';
  const documents: CorpusDocument[] = [];
  for (const [index, source] of parsed.entries()) {
    const documentId = `doc_${sha256(stableJson({ profile: options.profileId, text: source.text, index })).slice(0, 16)}`;
    const document: CorpusDocument = {
      document_id: documentId,
      profile_id: options.profileId,
      profile_type: profileType,
      rights_status: rightsStatus,
      platform: options.platform,
      content_type: options.contentType,
      title: source.title,
      source_filename: path.basename(options.sourcePath),
      imported_at: importedAt,
      text: source.text,
    };
    const relative = path.posix.join(targetDirectory, `${documentId}.json`);
    await secureWrite(path.join(options.corpusRoot, relative), `${JSON.stringify(document, null, 2)}\n`);
    documents.push(document);
  }
  const registryPath = path.join(options.corpusRoot, 'sources.local.yaml');
  const registry = YAML.parse(await readFile(registryPath, 'utf8')) as CorpusRegistry;
  const relativeFiles = documents.map(({ document_id }) => path.posix.join(targetDirectory, `${document_id}.json`));
  registry.sources.push({
    profile_id: options.profileId,
    profile_type: profileType,
    rights_status: rightsStatus,
    platform: options.platform,
    content_type: options.contentType,
    document_files: relativeFiles,
    imported_at: importedAt,
  });
  await secureWrite(registryPath, YAML.stringify(registry));
  return documents;
}

export async function loadCorpusDocuments(corpusRoot: string, profileId?: string): Promise<CorpusDocument[]> {
  await ensureStyleCorpus(corpusRoot);
  const documents: CorpusDocument[] = [];
  for (const directory of ['owner', 'references'] as const) {
    for (const entry of await readdir(path.join(corpusRoot, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const document = JSON.parse(await readFile(path.join(corpusRoot, directory, entry.name), 'utf8')) as CorpusDocument;
      if (profileId === undefined || document.profile_id === profileId) documents.push(document);
    }
  }
  return documents.sort((left, right) => left.document_id.localeCompare(right.document_id));
}

export async function inspectStyleCorpus(corpusRoot: string): Promise<{
  root: string;
  document_count: number;
  profiles: Array<{ profile_id: string; sample_count: number; corpus_hash: string }>;
  permissions: { directories_secure: boolean; files_secure: boolean };
}> {
  const documents = await loadCorpusDocuments(corpusRoot);
  const grouped = new Map<string, CorpusDocument[]>();
  for (const document of documents) grouped.set(document.profile_id, [...(grouped.get(document.profile_id) ?? []), document]);
  return {
    root: corpusRoot,
    document_count: documents.length,
    profiles: [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([profile_id, items]) => ({
      profile_id,
      sample_count: items.length,
      corpus_hash: sha256(stableJson(items.map(({ document_id, text }) => ({ document_id, text })))),
    })),
    permissions: await inspectCorpusPermissions(corpusRoot),
  };
}
