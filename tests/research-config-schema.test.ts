import { describe, expect, it } from 'vitest';
import { loadExperimentTaskCatalog, loadResearchIntelligenceConfig } from '../src/research/config.js';
import { experimentTaskCatalogSchema, researchAnswerSchema, researchIntelligenceConfigSchema } from '../src/research/schemas.js';

describe('research configuration contracts', () => {
  it('loads the committed strict research configuration', async () => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    expect(config).toMatchObject({ version: 1, timezone: 'Asia/Shanghai', research: { maximum_codex_calls: 4 } });
  });

  it('loads exactly three text-to-text synthetic tasks', async () => {
    const catalog = await loadExperimentTaskCatalog(process.cwd());
    expect(catalog.tasks).toHaveLength(3);
    expect(new Set(catalog.tasks.map(({ type }) => type))).toEqual(new Set(['text_to_text']));
  });

  it('provides eight deterministic acceptance criteria per task', async () => {
    const catalog = await loadExperimentTaskCatalog(process.cwd());
    expect(catalog.tasks.every((task) => task.acceptance_criteria.length === 8)).toBe(true);
  });

  it('rejects unknown research configuration keys', async () => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    expect(researchIntelligenceConfigSchema.safeParse({ ...config, unexpected: true }).success).toBe(false);
  });

  it.each([
    ['source_fetch.maximum_sources', 6],
    ['source_fetch.timeout_seconds', 0],
    ['source_fetch.maximum_redirects', 6],
    ['source_fetch.maximum_response_bytes', 2_097_153],
    ['source_fetch.maximum_clean_text_chars', 80_001],
    ['source_fetch.maximum_committed_quote_chars_per_source', 1_501],
    ['source_fetch.maximum_single_quote_chars', 501],
    ['research.maximum_questions', 6],
    ['research.maximum_verified_claims', 9],
    ['research.maximum_codex_calls', 5],
    ['research.repair_attempts', 2],
    ['experiment.maximum_variants', 3],
    ['experiment.maximum_acceptance_criteria', 9],
    ['experiment.maximum_output_chars_per_variant', 20_001],
    ['experiment.maximum_experiment_steps', 6],
    ['schedule.max_attempts', 3],
  ])('rejects invalid limit %s=%s', async (key, invalid) => {
    const config = structuredClone(await loadResearchIntelligenceConfig(process.cwd())) as Record<string, unknown>;
    const [group, field] = key.split('.');
    (config[group!] as Record<string, unknown>)[field!] = invalid;
    expect(researchIntelligenceConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects shell experiment tasks', async () => {
    const catalog = structuredClone(await loadExperimentTaskCatalog(process.cwd())) as Record<string, unknown>;
    ((catalog.tasks as Array<Record<string, unknown>>)[0]!).type = 'shell';
    expect(experimentTaskCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('rejects browser experiment tasks', async () => {
    const catalog = structuredClone(await loadExperimentTaskCatalog(process.cwd())) as Record<string, unknown>;
    ((catalog.tasks as Array<Record<string, unknown>>)[0]!).type = 'browser';
    expect(experimentTaskCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('rejects experiment tasks outside the catalog enum', async () => {
    const catalog = structuredClone(await loadExperimentTaskCatalog(process.cwd())) as Record<string, unknown>;
    ((catalog.tasks as Array<Record<string, unknown>>)[0]!).task_id = 'private_customer_export';
    expect(experimentTaskCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('rejects duplicate experiment task IDs', async () => {
    const catalog = structuredClone(await loadExperimentTaskCatalog(process.cwd()));
    catalog.tasks[1]!.task_id = catalog.tasks[0]!.task_id;
    expect(experimentTaskCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('rejects duplicate acceptance criterion IDs', async () => {
    const catalog = structuredClone(await loadExperimentTaskCatalog(process.cwd()));
    catalog.tasks[0]!.acceptance_criteria[1]!.criterion_id = catalog.tasks[0]!.acceptance_criteria[0]!.criterion_id;
    expect(experimentTaskCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('allows an answered non-factual task-selection question without a source claim', () => {
    expect(researchAnswerSchema.safeParse({
      question: 'Which safe synthetic task should be used?',
      answer_status: 'answered', gap_impact: 'none',
      answer: 'Use the project-owned product request fixture.',
      supporting_claim_ids: [], remaining_gap: '',
    }).success).toBe(true);
  });

  it('enforces the answered, partial, and unanswered gap-impact combinations', () => {
    const base = { question: 'Question', answer: 'Bounded answer', supporting_claim_ids: [], remaining_gap: '' };
    expect(researchAnswerSchema.safeParse({ ...base, answer_status: 'answered', gap_impact: 'blocking' }).success).toBe(false);
    expect(researchAnswerSchema.safeParse({ ...base, answer_status: 'partial', gap_impact: 'none', remaining_gap: 'Gap' }).success).toBe(false);
    expect(researchAnswerSchema.safeParse({ ...base, answer_status: 'unanswered', gap_impact: 'blocking' }).success).toBe(false);
  });
});
