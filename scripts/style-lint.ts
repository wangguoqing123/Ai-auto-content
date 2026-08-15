import { readFile } from 'node:fs/promises';
import { defaultStyleCorpusRoot, loadCorpusDocuments } from '../src/style-intelligence/corpus.js';
import { buildStyleFixtureDocuments } from '../src/style-intelligence/fixture.js';
import {
  resolveFixtureProtectedTransferIndexes,
  resolveProtectedTransferIndexes,
} from '../src/style-intelligence/protected-transfer.js';
import { lintHumanWriting } from '../src/writing-lint/human-writing-lint.js';
import { lintNoAiSlop } from '../src/writing-lint/no-ai-slop-lint.js';
import { guardAgainstPlagiarism } from '../src/writing-lint/plagiarism-guard.js';
import { loadAuthorizedResearchQuotes } from '../src/writing-lint/authorized-research-quotes.js';
import { buildWritingLintReport } from '../src/writing-lint/report.js';
import { argument, flag, requiredArgument } from './style-cli-args.js';

function protectedFailureCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (['protected_index_missing', 'protected_index_stale', 'protected_index_invalid', 'protected_index_insecure'].includes(message)) return message;
  if (/permission|insecure|symlink|outside_corpus|special_file/iu.test(message) && /protected|cache/iu.test(message)) return 'protected_index_insecure';
  return null;
}

const fixture = flag('fixture');
try {
  const draft = fixture
    ? '打开设置后选择测试文件。运行检查，再重新打开结果。报告里有 3 个字段，每个字段都能回读。做完后保存报告。'
    : await readFile(requiredArgument('draft'), 'utf8');
  const corpusRoot = argument('corpus-root') ?? defaultStyleCorpusRoot();
  const corpus = fixture ? buildStyleFixtureDocuments({ profileId: 'fixture-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' }) : await loadCorpusDocuments(corpusRoot);
  const researchPackPath = argument('research-pack');
  const authorizedResearchQuotes = researchPackPath === undefined ? undefined : await loadAuthorizedResearchQuotes(researchPackPath);
  const protectedIndexes = fixture
    ? resolveFixtureProtectedTransferIndexes()
    : await resolveProtectedTransferIndexes(corpusRoot, corpus);
  const plagiarism = guardAgainstPlagiarism({ draft, corpus, ...(authorizedResearchQuotes === undefined ? {} : { authorizedResearchQuotes }), protectedIndexes });
  const report = buildWritingLintReport([...lintHumanWriting(draft), ...lintNoAiSlop(draft), ...plagiarism.issues]);
  console.log(JSON.stringify({ fixture, ...report }, null, 2));
  if (report.status === 'blocked') process.exitCode = 1;
} catch (error) {
  const errorCode = protectedFailureCode(error);
  if (errorCode === null) throw error;
  console.log(JSON.stringify({
    fixture,
    status: 'blocked',
    error_code: errorCode,
    issues: [],
    counts: { hard_blocker: 1, blocking_style_issue: 0, warning: 0, profile_preference: 0 },
  }, null, 2));
  process.exitCode = 1;
}
