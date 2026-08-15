import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultStyleCorpusRoot, ensureStyleCorpus, loadCorpusDocuments } from '../src/style-intelligence/corpus.js';
import { distillStyleProfile } from '../src/style-intelligence/distill.js';
import { buildStyleFixtureDocuments, FixtureStyleProvider } from '../src/style-intelligence/fixture.js';
import { CodexCliStyleProvider } from '../src/style-intelligence/provider.js';
import type { StyleDistillProvider } from '../src/style-intelligence/provider.js';
import { buildStyleRecipe } from '../src/style-intelligence/recipe.js';
import { argument, flag, requiredArgument } from './style-cli-args.js';

const fixture = flag('fixture');
const corpusRoot = argument('corpus-root') ?? defaultStyleCorpusRoot();
const documents = fixture ? buildStyleFixtureDocuments() : await loadCorpusDocuments(corpusRoot, requiredArgument('profile-id'));
let provider: StyleDistillProvider | undefined;
if (fixture) provider = new FixtureStyleProvider();
else if (documents.length >= 8) {
  const model = process.env.STYLE_CODEX_MODEL?.trim() ?? '';
  if (model === '') throw new Error('STYLE_CODEX_MODEL is required for a ready Profile');
  provider = await CodexCliStyleProvider.create({ model });
}
const result = await distillStyleProfile({
  documents,
  ...(provider === undefined ? {} : { provider }),
  ...(fixture ? { createdAt: '2026-08-15T00:00:00.000Z' } : {}),
});
const ownerProfile = result.profile.status === 'ready' && result.profile.profile_type === 'owner_voice' ? result.profile : undefined;
const recipe = buildStyleRecipe({ articleType: 'tutorial', ...(ownerProfile === undefined ? {} : { ownerProfile }) });
if (!fixture) {
  await ensureStyleCorpus(corpusRoot);
  const output = path.join(corpusRoot, 'cache', `${result.profile.profile_id}.profile.v${result.profile.version}.json`);
  await writeFile(output, `${JSON.stringify(result.profile, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(output, 0o600);
}
console.log(JSON.stringify({
  status: result.profile.status,
  profile_id: result.profile.profile_id,
  sample_count: result.profile.sample_count,
  corpus_hash: result.profile.corpus_hash,
  recipe_hash: recipe.recipe_hash,
  model_calls: result.model_calls,
  provider: provider?.providerName ?? (result.profile.status === 'processing_not_allowed' ? 'none_processing_not_allowed' : 'none_insufficient_samples'),
  wrote_local_profile: !fixture,
}, null, 2));
