import { defaultStyleCorpusRoot, importCorpusDocuments } from '../src/style-intelligence/corpus.js';
import { profileTypeSchema, rightsStatusSchema } from '../src/style-intelligence/schemas.js';
import { argument, requiredArgument } from './style-cli-args.js';

const documents = await importCorpusDocuments({
  corpusRoot: argument('corpus-root') ?? defaultStyleCorpusRoot(),
  sourcePath: requiredArgument('source'),
  profileId: requiredArgument('profile-id'),
  profileType: profileTypeSchema.parse(requiredArgument('profile-type')),
  rightsStatus: rightsStatusSchema.parse(requiredArgument('rights-status')),
  platform: requiredArgument('platform'),
  contentType: requiredArgument('content-type'),
});
console.log(JSON.stringify({ imported: documents.length, document_ids: documents.map(({ document_id }) => document_id) }, null, 2));
