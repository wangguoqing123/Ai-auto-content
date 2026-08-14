import { execFileSync } from 'node:child_process';

const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
const files = output.split('\n').filter(Boolean);
const allowed = [
  /^data\/topic-decisions\//,
  /^data\/topic-runs\//,
  /^reports\/topics\//,
];
const forbidden = files.filter((file) => !allowed.some((pattern) => pattern.test(file)));
if (forbidden.length > 0) {
  console.error(`Topic workflow output whitelist violation: ${forbidden.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Topic workflow output whitelist passed (${files.length} staged files).`);
}
