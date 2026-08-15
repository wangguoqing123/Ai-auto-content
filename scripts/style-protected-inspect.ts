import { defaultStyleCorpusRoot, loadCorpusDocuments } from '../src/style-intelligence/corpus.js';
import {
  protectedEntryCounts,
  resolveProtectedTransferIndexes,
  resolvedProtectedTransferIndexRecords,
} from '../src/style-intelligence/protected-transfer.js';
import { argument, requiredArgument } from './style-cli-args.js';

const corpusRoot = argument('corpus-root') ?? defaultStyleCorpusRoot();
const profileId = requiredArgument('profile-id');
const documents = await loadCorpusDocuments(corpusRoot, profileId);
const resolved = await resolveProtectedTransferIndexes(corpusRoot, documents);
const index = resolvedProtectedTransferIndexRecords(resolved).find(({ profile_id }) => profile_id === profileId);
if (index === undefined) throw new Error('protected_index_missing');
console.log(JSON.stringify({
  profile_id: index.profile_id,
  corpus_hash: index.corpus_hash,
  created_at: index.created_at,
  status: 'ready',
  counts: protectedEntryCounts(index),
}, null, 2));
