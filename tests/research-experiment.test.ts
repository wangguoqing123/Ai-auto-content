import { beforeAll, describe, expect, it } from 'vitest';
import { loadExperimentTaskCatalog } from '../src/research/config.js';
import { evaluateExperimentOutput, runExperimentBundle } from '../src/research/experiment.js';
import { FixtureResearchProvider } from '../src/research/providers/fixture-research-provider.js';
import type { ExperimentCatalogTask, ExperimentOutput } from '../src/research/schemas.js';

let task: ExperimentCatalogTask;
beforeAll(async () => { task = (await loadExperimentTaskCatalog(process.cwd())).tasks[0]!; });
const limits = { timeoutMs: 20_000, maximumOutputChars: 20_000 };

function output(): ExperimentOutput {
  return {
    deliverable: {
      title: 'Brief', objective: 'Complete it', decisions: ['Use synthetic data'],
      actions: [{ task: 'Draft', owner: 'Lin', next_step: 'Write it', acceptance_condition: 'Checklist passes' }],
      acceptance_checklist: ['Checklist passes'], risks: ['One sample only'],
    },
    assumptions: [], missing_inputs: [], steps_taken: ['Drafted'], self_check: [],
  };
}

describe('deterministic research experiment evaluation', () => {
  it('runs baseline and structured exactly once each', async () => {
    const provider = new FixtureResearchProvider();
    await runExperimentBundle({ provider, task, ...limits });
    expect(provider.experimentCalls).toEqual(['baseline_chat_request', 'structured_task_card']);
  });

  it('uses one model and one synthetic input hash for both variants', async () => {
    const run = await runExperimentBundle({ provider: new FixtureResearchProvider(), task, ...limits });
    expect(run.bundle.spec.model).toBe('offline-fixture');
    expect(run.bundle.spec.input_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.bundle.spec.variants[0].prompt_sha256).not.toBe(run.bundle.spec.variants[1].prompt_sha256);
  });

  it('records fixture baseline and structured pass counts from code', async () => {
    const run = await runExperimentBundle({ provider: new FixtureResearchProvider(), task, ...limits });
    expect(run.bundle.results[0]).toMatchObject({ criterion_pass_count: 3, criterion_fail_count: 5 });
    expect(run.bundle.results[1]).toMatchObject({ criterion_pass_count: 8, criterion_fail_count: 0 });
  });

  it('records non-empty limitations without efficiency percentages', async () => {
    const run = await runExperimentBundle({ provider: new FixtureResearchProvider(), task, ...limits });
    expect(run.bundle.limitations.length).toBeGreaterThan(0);
    expect(JSON.stringify(run.bundle)).not.toMatch(/\d+%|percent faster|accuracy improvement/i);
  });

  it('rejects a variant output beyond the configured character cap', async () => {
    const provider = new FixtureResearchProvider();
    await expect(runExperimentBundle({ provider, task, timeoutMs: 20_000, maximumOutputChars: 10 }))
      .rejects.toMatchObject({ code: 'codex_output_invalid' });
  });

  it.each([
    ['title'], ['objective'], ['decisions'], ['actions'], ['acceptance_checklist'], ['risks'],
  ] as const)('detects missing required deliverable field %s', (field) => {
    const value = output();
    if (typeof value.deliverable[field] === 'string') (value.deliverable[field] as string) = '';
    else (value.deliverable[field] as unknown[]) = [];
    const result = evaluateExperimentOutput(task, 'baseline_chat_request', value, 1, null);
    expect(result.missing_required_fields).toContain(field);
    expect(result.criterion_results.find(({ criterion_id }) => criterion_id === 'required_fields_complete')?.status).toBe('fail');
  });

  it('fails executable next steps when actions lack an owner', () => {
    const value = output();
    value.deliverable.actions[0]!.owner = '';
    const result = evaluateExperimentOutput(task, 'baseline_chat_request', value, 1, null);
    expect(result.criterion_results.find(({ criterion_id }) => criterion_id === 'executable_next_steps')?.status).toBe('fail');
  });

  it('fails assumptions_bounded when an assumption is declared', () => {
    const value = output();
    value.assumptions = ['Unsupported assumption'];
    const result = evaluateExperimentOutput(task, 'baseline_chat_request', value, 1, null);
    expect(result.criterion_results.find(({ criterion_id }) => criterion_id === 'assumptions_bounded')?.status).toBe('fail');
  });

  it('fails no_major_supplementation when missing inputs remain', () => {
    const value = output();
    value.missing_inputs = ['Need owner'];
    const result = evaluateExperimentOutput(task, 'baseline_chat_request', value, 1, null);
    expect(result.criterion_results.find(({ criterion_id }) => criterion_id === 'no_major_supplementation')?.status).toBe('fail');
  });

  it('always records strict output format as code-validated after parsing', () => {
    const result = evaluateExperimentOutput(task, 'structured_task_card', output(), 1, null);
    expect(result.criterion_results.find(({ criterion_id }) => criterion_id === 'strict_output_format')?.status).toBe('pass');
  });

  it('records duration, usage, parse status, and Codex exit status', () => {
    const usage = { input_tokens: 1, output_tokens: 2, total_tokens: 3 };
    expect(evaluateExperimentOutput(task, 'structured_task_card', output(), 123, usage)).toMatchObject({
      duration_ms: 123, token_usage: usage, output_parse_status: 'valid', codex_exit_status: 'success',
    });
  });
});
