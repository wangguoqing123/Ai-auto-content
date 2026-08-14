import { runTopicSelection } from '../src/topic-intelligence/pipeline.js';
import type { FixtureTopicJudgeMode } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';

function optionValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const date = optionValue('date') ?? new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(JSON.stringify({ status: 'failed', error_code: 'configuration_invalid', error_message_safe: 'Invalid --date value.' }));
  process.exitCode = 1;
} else {
  const fixture = process.argv.includes('--fixture');
  const dryRun = process.argv.includes('--dry-run');
  const fixtureMode = (optionValue('fixture-mode') ?? 'select') as FixtureTopicJudgeMode;
  const allowedModes: FixtureTopicJudgeMode[] = ['select', 'no-publish', 'invalid', 'repairable', 'invalid-twice', 'network-failure', 'timeout', 'repair-timeout'];
  if (!allowedModes.includes(fixtureMode)) {
    console.error(JSON.stringify({ status: 'failed', error_code: 'configuration_invalid', error_message_safe: 'Invalid fixture mode.' }));
    process.exitCode = 1;
  } else {
    const result = await runTopicSelection({ decisionDate: date, fixture, dryRun, fixtureMode });
    console.log(JSON.stringify(result, null, 2));
    if (result.decision.status === 'failed') {
      process.exitCode = result.decision.error_code === 'model_output_invalid'
        ? 2
        : result.decision.error_code === 'model_unavailable' || result.decision.error_code === 'model_timeout'
          ? 3 : 4;
    }
  }
}
