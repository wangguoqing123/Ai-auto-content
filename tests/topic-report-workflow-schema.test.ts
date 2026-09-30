import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { runTopicSelection } from '../src/topic-intelligence/pipeline.js';
import { buildFixtureMaterialInput } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';
import { renderTopicReport } from '../src/topic-intelligence/report.js';

describe('topic report, JSON Schema, and workflows', () => {
  it('renders exactly one final mother topic for SELECT_TOPIC', async () => {
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    const report = renderTopicReport(decision, buildFixtureMaterialInput().materialById);
    expect(report.match(/## 最终母题/g)).toHaveLength(1);
    expect(report).toContain(decision.selected_topic?.working_title);
  });

  it('renders no selected topic for NO_PUBLISH', async () => {
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true, fixtureMode: 'no-publish' })).decision;
    expect(renderTopicReport(decision, buildFixtureMaterialInput().materialById)).not.toContain('## 最终母题');
  });

  it.each(['事实来源', '趋势信号', '结构参考', '限制使用材料'])(
    'separates the %s evidence role',
    async (heading) => {
      const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
      expect(renderTopicReport(decision, buildFixtureMaterialInput().materialById)).toContain(`### ${heading}`);
    },
  );

  it('does not show an untraceable URL for restricted materials', async () => {
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    if (decision.selected_topic === null) throw new Error('expected fixture selection');
    decision.selected_topic.restricted_inspiration_ids = ['mat_333333333333'];
    const report = renderTopicReport(decision, buildFixtureMaterialInput().materialById);
    expect(report).toContain('mat_333333333333');
    expect(report).not.toContain('weixin.sogou.com/link');
  });

  it.each(['公众号全文', 'X 正文', '配图 Prompt', '封面文字', 'price_cny'])(
    'does not generate forbidden output %s',
    async (forbidden) => {
      const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
      expect(renderTopicReport(decision, buildFixtureMaterialInput().materialById)).not.toContain(forbidden);
    },
  );

  it('shows only platform plan enums instead of platform copy', async () => {
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    const report = renderTopicReport(decision, buildFixtureMaterialInput().materialById);
    expect(report).toContain('公众号文章类型：tutorial');
    expect(report).toContain('X：single_post');
  });

  it('shows CTA mode, claim IDs, and price refresh flag without sales language', async () => {
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    const report = renderTopicReport(decision, buildFixtureMaterialInput().materialById);
    expect(report).toContain('price_refresh_required：true');
    expect(report).not.toContain('立即加入');
    expect(report).not.toContain('限时');
  });

  it('validates the fixture SELECT_TOPIC using the committed JSON Schema', async () => {
    const schema = JSON.parse(await readFile(path.join(process.cwd(), 'schemas', 'topic-decision.schema.json'), 'utf8'));
    const validate = new Ajv2020({ strict: false, allErrors: true, formats: { date: true, 'date-time': true } }).compile(schema);
    expect(validate((await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision)).toBe(true);
  });

  it.each([
    ['SELECT_TOPIC without selected topic', { status: 'success', decision: 'SELECT_TOPIC', selected_topic: null }],
    ['NO_PUBLISH with selected topic', { status: 'success', decision: 'NO_PUBLISH', no_publish_reason_code: 'weak_user_value', no_publish_reason: 'reason' }],
    ['failed with business decision', { status: 'failed', decision: 'NO_PUBLISH', error_code: 'model_unavailable' }],
  ])('JSON Schema rejects %s', async (_label, overrides) => {
    const schema = JSON.parse(await readFile(path.join(process.cwd(), 'schemas', 'topic-decision.schema.json'), 'utf8'));
    const validate = new Ajv2020({ strict: false, allErrors: true, formats: { date: true, 'date-time': true } }).compile(schema);
    const success = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    expect(validate({ ...success, ...overrides })).toBe(false);
  });

  it('JSON Schema rejects a fourth evaluated candidate', async () => {
    const schema = JSON.parse(await readFile(path.join(process.cwd(), 'schemas', 'topic-decision.schema.json'), 'utf8'));
    const validate = new Ajv2020({ strict: false, formats: { date: true, 'date-time': true } }).compile(schema);
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    expect(validate({ ...decision, evaluated_candidates: Array(4).fill(decision.selected_topic) })).toBe(false);
  });

  it('JSON Schema rejects extra properties', async () => {
    const schema = JSON.parse(await readFile(path.join(process.cwd(), 'schemas', 'topic-decision.schema.json'), 'utf8'));
    const validate = new Ajv2020({ strict: false, formats: { date: true, 'date-time': true } }).compile(schema);
    const decision = (await runTopicSelection({ decisionDate: '2026-08-14', fixture: true })).decision;
    expect(validate({ ...decision, secret: 'nope' })).toBe(false);
  });

  it('removes the GitHub Actions production topic schedule', async () => {
    await expect(readFile(path.join(process.cwd(), '.github', 'workflows', 'daily-topic-selection.yml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps PR validation fixture-only without Codex or API credentials', async () => {
    const text = await readFile(path.join(process.cwd(), '.github', 'workflows', 'pr-validation.yml'), 'utf8');
    expect(text).toContain('npm run topic:select -- --fixture --date=2026-08-14');
    expect(text).not.toMatch(/OPENAI_API_KEY|TOPIC_CODEX|codex exec|schedule:/);
  });

  it('configures the Local Runtime topic, research, and Simple Writing windows and maximum attempts', async () => {
    const text = await readFile(path.join(process.cwd(), 'config', 'local-runtime.yaml'), 'utf8');
    expect(text).toContain('topic_selection:');
    expect(text).toContain('target_time: "13:00"');
    expect(text).toContain('window_end: "18:00"');
    expect(text).toContain('target_time: "13:30"');
    expect(text).toContain('window_end: "21:00"');
    expect(text).toContain('target_time: "14:30"');
    expect(text).toContain('window_end: "22:00"');
    expect(text.match(/max_attempts: 2/g)).toHaveLength(3);
  });

  it('retains the 15-minute LaunchAgent due check and passes Codex explicitly', async () => {
    const text = await readFile(path.join(process.cwd(), 'launchd', 'com.ai-auto-content.local-scheduler.plist.template'), 'utf8');
    expect(text).toContain('<integer>900</integer>');
    expect(text).toContain('{{CODEX_PATH}}');
    expect(text).toContain('{{CODEX_MODEL}}');
    expect(text).not.toMatch(/OPENAI_API_KEY|GITHUB_TOKEN|Cookie/i);
  });

  it('uses the exact Local Runtime Topic output whitelist', async () => {
    const text = await readFile(path.join(process.cwd(), 'src', 'local-runtime', 'git-sync.ts'), 'utf8');
    expect(text).toContain("'data/topic-decisions'");
    expect(text).toContain("'data/topic-runs'");
    expect(text).toContain("'reports/topics'");
    expect(text).toContain('chore(topic): decide daily topic');
  });

  it('aborts a Topic rebase conflict without force push', async () => {
    const text = await readFile(path.join(process.cwd(), 'src', 'local-runtime', 'git-sync.ts'), 'utf8');
    expect(text).toContain("['rebase', '--abort']");
    expect(text).not.toMatch(/push[^\n]+--force/);
  });

  it('adds only the offline fixture command to PR validation', async () => {
    const text = await readFile(path.join(process.cwd(), '.github', 'workflows', 'pr-validation.yml'), 'utf8');
    expect(text).toContain('npm run topic:select -- --fixture --date=2026-08-14');
    expect(text).not.toContain('OPENAI_API_KEY');
    expect(text).not.toContain('collect:browser');
  });

  it.each(['topic:select', 'topic:validate', 'topic:inspect-input'])(
    'exposes npm script %s',
    async (script) => {
      const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      expect(pkg.scripts[script]).toBeTruthy();
    },
  );
});
