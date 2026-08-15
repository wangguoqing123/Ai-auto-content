import { defaultStyleCorpusRoot, importCorpusDocuments } from '../src/style-intelligence/corpus.js';
import { profileTypeSchema, rightsBasisSchema, rightsStatusSchema } from '../src/style-intelligence/schemas.js';
import { argument, requiredArgument } from './style-cli-args.js';

const modelProcessing = requiredArgument('model-processing');
if (!['allowed', 'denied'].includes(modelProcessing)) throw new Error('--model-processing must be allowed or denied');
const rightsStatus = rightsStatusSchema.parse(requiredArgument('rights-status'));
const sourceUrl = argument('source-url');
if (rightsStatus === 'public_reference' && sourceUrl === undefined) throw new Error('Public references require --source-url');
const documents = await importCorpusDocuments({
  corpusRoot: argument('corpus-root') ?? defaultStyleCorpusRoot(),
  sourcePath: requiredArgument('source'),
  profileId: requiredArgument('profile-id'),
  profileType: profileTypeSchema.parse(requiredArgument('profile-type')),
  rightsStatus,
  platform: requiredArgument('platform'),
  contentType: requiredArgument('content-type'),
  source: {
    creator_id: requiredArgument('creator-id'),
    creator_display_name: requiredArgument('creator-name'),
    canonical_url: sourceUrl ?? null,
    platform_item_id: requiredArgument('platform-item-id'),
    published_at: requiredArgument('published-at'),
  },
  rights: {
    basis: rightsBasisSchema.parse(requiredArgument('rights-basis')),
    permission_reference: requiredArgument('permission-reference'),
    confirmed_at: requiredArgument('rights-confirmed-at'),
  },
  modelProcessing: {
    allowed: modelProcessing === 'allowed',
    consent_recorded_at: requiredArgument('consent-recorded-at'),
  },
});
console.log(JSON.stringify({ imported: documents.length, document_ids: documents.map(({ document_id }) => document_id) }, null, 2));
