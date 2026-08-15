import { readFile } from 'node:fs/promises';
import { defaultStyleCorpusRoot } from '../src/style-intelligence/corpus.js';
import { computeStyleChangeSignature, loadStyleFeedback, proposeProfileDelta, recordStyleFeedback, styleFeedbackChangeSchema } from '../src/style-intelligence/feedback.js';
import { sha256 } from '../src/style-intelligence/hash.js';
import { articleTypeSchema } from '../src/style-intelligence/schemas.js';
import { argument, flag, requiredArgument } from './style-cli-args.js';

const corpusRoot = argument('corpus-root') ?? defaultStyleCorpusRoot();
const before = await readFile(requiredArgument('before'), 'utf8');
const after = await readFile(requiredArgument('after'), 'utf8');
const loadChanges = async (name: string) => {
  const filename = argument(name);
  if (filename === undefined) return [];
  return styleFeedbackChangeSchema.array().parse(JSON.parse(await readFile(filename, 'utf8')));
};
const acceptedChanges = await loadChanges('accepted-json');
const rejectedChanges = await loadChanges('rejected-json');
const entry = await recordStyleFeedback(corpusRoot, {
  writing_pack_id: requiredArgument('writing-pack-id'),
  writing_input_hash: requiredArgument('writing-input-hash'),
  draft_hash: sha256(before),
  profile_id: requiredArgument('profile-id'),
  profile_version: Number.parseInt(requiredArgument('profile-version'), 10),
  change_signature: computeStyleChangeSignature([...acceptedChanges, ...rejectedChanges]),
  before,
  after,
  accepted_changes: acceptedChanges,
  rejected_changes: rejectedChanges,
  reason_labels: requiredArgument('reason-labels').split(',').map((value) => value.trim()).filter(Boolean),
  platform: requiredArgument('platform'),
  article_type: articleTypeSchema.parse(requiredArgument('article-type')),
  cross_type: flag('cross-type'),
  timestamp: new Date().toISOString(),
});
const proposedProfileDelta = proposeProfileDelta(await loadStyleFeedback(corpusRoot));
console.log(JSON.stringify({ feedback_id: entry.feedback_id, proposed_profile_delta: proposedProfileDelta }, null, 2));
