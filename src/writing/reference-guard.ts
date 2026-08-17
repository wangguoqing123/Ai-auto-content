import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { computeStyleCorpusHash } from '../style-intelligence/hash.js';
import { corpusDocumentSchema, type CorpusDocument } from '../style-intelligence/schemas.js';
import { protectedTransferIndexSchema, resolveFixtureProtectedTransferIndexes } from '../style-intelligence/protected-transfer.js';
import { assertNoSymlinkComponents } from '../style-intelligence/safe-local-path.js';

async function privateRead(filename: string, root: string): Promise<string> {
  await assertNoSymlinkComponents(filename);
  const canonicalRoot = await realpath(root);
  const relative = path.relative(canonicalRoot, path.resolve(filename));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('reference_guard_path_outside_corpus');
  const info = await lstat(filename);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('reference_guard_file_invalid');
  if ((info.mode & 0o777) !== 0o600) throw new Error('reference_guard_file_insecure');
  const handle = await open(filename, 'r');
  try { return await handle.readFile('utf8'); } finally { await handle.close(); }
}

export async function loadReferenceGuardInputsReadOnly(corpusRoot: string, expectedProfileId: string) {
  const referencesDirectory = path.join(corpusRoot, 'references');
  await assertNoSymlinkComponents(referencesDirectory);
  const documents: CorpusDocument[] = [];
  for (const entry of await readdir(referencesDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filename = path.join(referencesDirectory, entry.name);
    const document = corpusDocumentSchema.parse(JSON.parse(await privateRead(filename, corpusRoot)) as unknown);
    if (document.content_sha256 !== createHash('sha256').update(document.text).digest('hex')) throw new Error('reference_guard_content_hash_mismatch');
    if (document.profile_id === expectedProfileId && document.rights_status === 'public_reference') documents.push(document);
  }
  if (documents.length === 0) throw new Error('reference_guard_corpus_missing');
  documents.sort((left, right) => left.document_id.localeCompare(right.document_id));
  const indexFilename = path.join(corpusRoot, 'cache', 'protected', `${expectedProfileId}.protected.json`);
  const index = protectedTransferIndexSchema.parse(JSON.parse(await privateRead(indexFilename, corpusRoot)) as unknown);
  if (index.profile_id !== expectedProfileId || index.corpus_hash !== computeStyleCorpusHash(documents)) throw new Error('protected_index_stale');
  return { corpus: documents, protectedIndexes: resolveFixtureProtectedTransferIndexes([index]) };
}
