import { chmod, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { corpusDocumentSchema, profileTypeSchema, rightsStatusSchema } from './schemas.js';
import { computeStyleCorpusHash, sha256, stableJson } from './hash.js';
import {
  assertCorpusTreeSecure,
  assertNoSymlinkComponents,
  assertRegularPrivateFile,
  readPrivateCorpusFile,
  readVerifiedSourceFile,
  resolveVerifiedCorpusRoot,
  secureAtomicWrite,
} from './safe-local-path.js';
import type { CorpusDocument, CorpusImportOptions } from './types.js';

const corpusDirectories = ['owner', 'references', 'feedback', 'cache', 'cache/protected'] as const;

interface CorpusSourceEntry {
  document_id: string;
  profile_id: string;
  profile_type: CorpusDocument['profile_type'];
  rights_status: CorpusDocument['rights_status'];
  platform: string;
  content_type: string;
  content_sha256: string;
  document_file: string;
  source: CorpusDocument['source'];
  rights: CorpusDocument['rights'];
  model_processing: CorpusDocument['model_processing'];
  imported_at: string;
}

interface CorpusRegistry { version: 2; sources: CorpusSourceEntry[] }

interface ParsedSourceDocument {
  title: string;
  text: string;
  platform?: string;
  content_type?: string;
  source?: Partial<CorpusDocument['source']>;
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
  await assertNoSymlinkComponents(path.dirname(directory));
  try {
    const existing = await lstat(directory);
    if (existing.isSymbolicLink()) throw new Error(`corpus_directory_symlink_not_allowed:${directory}`);
    if (!existing.isDirectory()) throw new Error(`corpus_directory_required:${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(directory, { mode: 0o700 });
  }
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`corpus_directory_invalid:${directory}`);
  await chmod(directory, 0o700);
}

export async function secureCorpusWrite(filename: string, content: string): Promise<void> {
  await secureAtomicWrite(filename, content);
}

export async function ensureStyleCorpus(corpusRoot = defaultStyleCorpusRoot()): Promise<string> {
  assertCorpusOutsideRepository(corpusRoot);
  const resolvedRoot = await resolveVerifiedCorpusRoot(corpusRoot);
  for (const directory of corpusDirectories) await secureDirectory(path.join(resolvedRoot, directory));
  const registryPath = path.join(resolvedRoot, 'sources.local.yaml');
  try {
    await assertRegularPrivateFile(registryPath, resolvedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await secureCorpusWrite(registryPath, YAML.stringify({ version: 2, sources: [] } satisfies CorpusRegistry));
  }
  await assertCorpusTreeSecure(resolvedRoot);
  return resolvedRoot;
}

export async function inspectCorpusPermissions(corpusRoot: string): Promise<{ directories_secure: boolean; files_secure: boolean }> {
  const root = await ensureStyleCorpus(corpusRoot);
  const directoryModes = await Promise.all([root, ...corpusDirectories.map((directory) => path.join(root, directory))]
    .map(async (directory) => (await lstat(directory)).mode & 0o777));
  let filesSecure = true;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(child);
      else {
        try { await assertRegularPrivateFile(child, root); } catch { filesSecure = false; }
      }
    }
  };
  await walk(root);
  return { directories_secure: directoryModes.every((mode) => mode === 0o700), files_secure: filesSecure };
}

function objectOrUndefined(value: unknown, line: number, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${field} at JSONL line ${line}`);
  return value as Record<string, unknown>;
}

function parseSourceDocuments(sourcePath: string, raw: string): ParsedSourceDocument[] {
  const extension = path.extname(sourcePath).toLocaleLowerCase();
  if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
    const heading = raw.match(/^#\s+(.+)$/mu)?.[1]?.trim();
    return [{ title: heading ?? path.basename(sourcePath, extension), text: raw.trim() }];
  }
  if (extension === '.jsonl') {
    return raw.split(/\r?\n/u).filter((line) => line.trim() !== '').map((line, index) => {
      const lineNumber = index + 1;
      const value = JSON.parse(line) as unknown;
      if (typeof value === 'string') return { title: `${path.basename(sourcePath)} ${lineNumber}`, text: value.trim() };
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid JSONL document at line ${lineNumber}`);
      const record = value as Record<string, unknown>;
      if ('rights' in record || 'permission_reference' in record || 'rights_basis' in record || 'confirmed_at' in record) {
        throw new Error('inline_rights_metadata_not_allowed');
      }
      if ('model_processing' in record || 'consent' in record || 'consent_recorded_at' in record || 'provider_scope' in record) {
        throw new Error('inline_model_processing_metadata_not_allowed');
      }
      if (typeof record.text !== 'string' || record.text.trim() === '') throw new Error(`Missing text at JSONL line ${lineNumber}`);
      const source = objectOrUndefined(record.source, lineNumber, 'source');
      return {
        title: typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : `${path.basename(sourcePath)} ${lineNumber}`,
        text: record.text.trim(),
        ...(typeof record.platform === 'string' ? { platform: record.platform } : {}),
        ...(typeof record.content_type === 'string' ? { content_type: record.content_type } : {}),
        ...(source === undefined ? {} : { source: source as Partial<CorpusDocument['source']> }),
      };
    });
  }
  throw new Error('style_import_supports_markdown_text_or_jsonl_only');
}

function registryEntry(document: CorpusDocument, documentFile: string): CorpusSourceEntry {
  return {
    document_id: document.document_id,
    profile_id: document.profile_id,
    profile_type: document.profile_type,
    rights_status: document.rights_status,
    platform: document.platform,
    content_type: document.content_type,
    content_sha256: document.content_sha256,
    document_file: documentFile,
    source: document.source,
    rights: document.rights,
    model_processing: document.model_processing,
    imported_at: document.imported_at,
  };
}

export async function importCorpusDocuments(options: CorpusImportOptions): Promise<CorpusDocument[]> {
  const verifiedSource = await readVerifiedSourceFile(options.sourcePath);
  const corpusRoot = await ensureStyleCorpus(options.corpusRoot);
  const profileType = profileTypeSchema.parse(options.profileType);
  const rightsStatus = rightsStatusSchema.parse(options.rightsStatus);
  if (typeof options.modelProcessing?.allowed !== 'boolean') throw new Error('model_processing_allowed_must_be_explicit');
  const importedAt = options.importedAt ?? new Date().toISOString();
  const parsed = parseSourceDocuments(verifiedSource.path, verifiedSource.content);
  if (parsed.length === 0) throw new Error('style_source_contains_no_documents');
  const targetDirectory = profileType === 'owner_voice' ? 'owner' : 'references';
  const existing = await loadCorpusDocuments(corpusRoot, options.profileId);
  const seenHashes = new Set(existing.map(({ content_sha256 }) => content_sha256));
  const seenItems = new Set(existing.map(({ source }) => `${source.canonical_url}\n${source.platform_item_id}`));
  const documents: CorpusDocument[] = [];
  for (const source of parsed) {
    const contentSha256 = sha256(source.text);
    const provenance = {
      ...options.source,
      source_filename: path.basename(verifiedSource.path),
      ...(source.source ?? {}),
    };
    const itemKey = `${provenance.canonical_url}\n${provenance.platform_item_id}`;
    if (seenHashes.has(contentSha256) || seenItems.has(itemKey)) continue;
    const documentId = `doc_${sha256(stableJson({ profile_id: options.profileId, content_sha256: contentSha256, canonical_url: provenance.canonical_url, platform_item_id: provenance.platform_item_id })).slice(0, 16)}`;
    const document = corpusDocumentSchema.parse({
      document_id: documentId,
      profile_id: options.profileId,
      profile_type: profileType,
      rights_status: rightsStatus,
      platform: source.platform ?? options.platform,
      content_type: source.content_type ?? options.contentType,
      title: source.title,
      text: source.text,
      content_sha256: contentSha256,
      source: provenance,
      rights: options.rights,
      model_processing: {
        allowed: options.modelProcessing.allowed,
        provider_scope: options.modelProcessing.allowed ? 'codex_cli' : 'none',
        consent_recorded_at: options.modelProcessing.consent_recorded_at,
      },
      imported_at: importedAt,
    });
    const relative = path.posix.join(targetDirectory, `${documentId}.json`);
    await secureCorpusWrite(path.join(corpusRoot, relative), `${JSON.stringify(document, null, 2)}\n`);
    documents.push(document);
    seenHashes.add(contentSha256);
    seenItems.add(itemKey);
  }
  if (documents.length === 0) return [];
  const registryPath = path.join(corpusRoot, 'sources.local.yaml');
  const rawRegistry = YAML.parse(await readPrivateCorpusFile(registryPath, corpusRoot)) as Partial<CorpusRegistry>;
  const registry: CorpusRegistry = { version: 2, sources: Array.isArray(rawRegistry.sources) ? rawRegistry.sources : [] };
  registry.sources.push(...documents.map((document) => registryEntry(document, path.posix.join(targetDirectory, `${document.document_id}.json`))));
  await secureCorpusWrite(registryPath, YAML.stringify(registry));
  return documents;
}

export async function loadCorpusDocuments(corpusRoot: string, profileId?: string): Promise<CorpusDocument[]> {
  const root = await ensureStyleCorpus(corpusRoot);
  const documents: CorpusDocument[] = [];
  for (const directory of ['owner', 'references'] as const) {
    const absoluteDirectory = path.join(root, directory);
    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
      const filename = path.join(absoluteDirectory, entry.name);
      const info = await lstat(filename);
      if (info.isSymbolicLink()) throw new Error(`corpus_symlink_not_allowed:${filename}`);
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const document = corpusDocumentSchema.parse(JSON.parse(await readPrivateCorpusFile(filename, root)));
      if (document.content_sha256 !== sha256(document.text)) throw new Error(`corpus_content_hash_mismatch:${document.document_id}`);
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
  const root = await ensureStyleCorpus(corpusRoot);
  const documents = await loadCorpusDocuments(root);
  const grouped = new Map<string, CorpusDocument[]>();
  for (const document of documents) grouped.set(document.profile_id, [...(grouped.get(document.profile_id) ?? []), document]);
  return {
    root: await realpath(root),
    document_count: documents.length,
    profiles: [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([profile_id, items]) => ({
      profile_id,
      sample_count: items.length,
      corpus_hash: computeStyleCorpusHash(items),
    })),
    permissions: await inspectCorpusPermissions(root),
  };
}
