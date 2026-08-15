import { readFile } from 'node:fs/promises';
import { defaultStyleCorpusRoot, loadCorpusDocuments } from '../src/style-intelligence/corpus.js';
import { buildStyleFixtureDocuments } from '../src/style-intelligence/fixture.js';
import { lintHumanWriting } from '../src/writing-lint/human-writing-lint.js';
import { lintNoAiSlop } from '../src/writing-lint/no-ai-slop-lint.js';
import { guardAgainstPlagiarism } from '../src/writing-lint/plagiarism-guard.js';
import { loadAuthorizedResearchQuotes } from '../src/writing-lint/authorized-research-quotes.js';
import { loadProtectedTransferIndex } from '../src/style-intelligence/protected-transfer.js';
import { buildWritingLintReport } from '../src/writing-lint/report.js';
import { argument, flag, requiredArgument } from './style-cli-args.js';

const fixture = flag('fixture');
const draft = fixture
  ? '打开设置后选择测试文件。运行检查，再重新打开结果。报告里有 3 个字段，每个字段都能回读。做完后保存报告。'
  : await readFile(requiredArgument('draft'), 'utf8');
const corpusRoot = argument('corpus-root') ?? defaultStyleCorpusRoot();
const corpus = fixture ? buildStyleFixtureDocuments({ profileId: 'fixture-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' }) : await loadCorpusDocuments(corpusRoot);
const researchPackPath = argument('research-pack');
const authorizedResearchQuotes = researchPackPath === undefined ? undefined : await loadAuthorizedResearchQuotes(researchPackPath);
const referenceProfileIds = [...new Set(corpus.filter(({ rights_status }) => rights_status === 'public_reference').map(({ profile_id }) => profile_id))];
const protectedIndexes = fixture ? [] : (await Promise.all(referenceProfileIds.map((profileId) => loadProtectedTransferIndex(corpusRoot, profileId)))).filter((index) => index !== null);
const plagiarism = guardAgainstPlagiarism({ draft, corpus, ...(authorizedResearchQuotes === undefined ? {} : { authorizedResearchQuotes }), protectedIndexes });
const report = buildWritingLintReport([...lintHumanWriting(draft), ...lintNoAiSlop(draft), ...plagiarism.issues]);
console.log(JSON.stringify({ fixture, ...report }, null, 2));
if (report.status === 'blocked') process.exitCode = 1;
