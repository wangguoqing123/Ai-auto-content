import { readFile } from 'node:fs/promises';
import { defaultStyleCorpusRoot } from '../src/style-intelligence/corpus.js';
import { loadStyleFeedback, proposeProfileDelta, recordStyleFeedback } from '../src/style-intelligence/feedback.js';
import { articleTypeSchema } from '../src/style-intelligence/schemas.js';
import { argument, requiredArgument } from './style-cli-args.js';

const corpusRoot = argument('corpus-root') ?? defaultStyleCorpusRoot();
const entry = await recordStyleFeedback(corpusRoot, {
  before: await readFile(requiredArgument('before'), 'utf8'),
  after: await readFile(requiredArgument('after'), 'utf8'),
  accepted_changes: (argument('accepted') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  rejected_changes: (argument('rejected') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  reason_labels: requiredArgument('reason-labels').split(',').map((value) => value.trim()).filter(Boolean),
  platform: requiredArgument('platform'),
  article_type: articleTypeSchema.parse(requiredArgument('article-type')),
  timestamp: new Date().toISOString(),
});
const proposedProfileDelta = proposeProfileDelta(await loadStyleFeedback(corpusRoot));
console.log(JSON.stringify({ feedback_id: entry.feedback_id, proposed_profile_delta: proposedProfileDelta }, null, 2));
