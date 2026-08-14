import { createHash } from 'node:crypto';
import { buildExperimentInput } from './prompt.js';
import {
  experimentBundleSchema,
  type ExperimentBundle,
  type ExperimentCatalogTask,
  type ExperimentOutput,
  type ExperimentResult,
} from './schemas.js';
import { ResearchProviderUnavailableError, type ResearchProvider } from './providers/research-provider.js';
import type { ResearchProviderCall } from './providers/research-provider.js';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function missingFields(task: ExperimentCatalogTask, output: ExperimentOutput): string[] {
  return task.required_deliverable_fields.filter((field) => {
    const value = output.deliverable[field];
    return typeof value === 'string' ? value.trim() === '' : value.length === 0;
  });
}

export function evaluateExperimentOutput(
  task: ExperimentCatalogTask,
  variant: ExperimentResult['variant_id'],
  output: ExperimentOutput,
  durationMs: number,
  usage: ExperimentResult['token_usage'],
): ExperimentResult {
  const missing = missingFields(task, output);
  const actionComplete = output.deliverable.actions.some((action) =>
    action.task.trim() !== '' && action.owner.trim() !== ''
      && action.next_step.trim() !== '' && action.acceptance_condition.trim() !== '');
  const resultById: Record<string, { status: 'pass' | 'fail'; evidence: string }> = {
    deliverable_present: {
      status: output.deliverable.title.trim() !== '' && output.deliverable.objective.trim() !== '' ? 'pass' : 'fail',
      evidence: 'Checked title and objective fields.',
    },
    required_fields_complete: {
      status: missing.length === 0 ? 'pass' : 'fail',
      evidence: missing.length === 0 ? 'All required fields are populated.' : `Missing fields: ${missing.join(', ')}`,
    },
    missing_inputs_explicit: { status: 'pass', evidence: `missing_inputs is explicit with ${output.missing_inputs.length} item(s).` },
    executable_next_steps: { status: actionComplete ? 'pass' : 'fail', evidence: 'Checked action owner, next step, and acceptance condition.' },
    acceptance_mapped: {
      status: output.deliverable.acceptance_checklist.length > 0 ? 'pass' : 'fail',
      evidence: `Found ${output.deliverable.acceptance_checklist.length} acceptance item(s).`,
    },
    assumptions_bounded: {
      status: output.assumptions.length === 0 ? 'pass' : 'fail',
      evidence: `Found ${output.assumptions.length} declared assumption(s).`,
    },
    strict_output_format: { status: 'pass', evidence: 'Output passed the shared strict schema.' },
    no_major_supplementation: {
      status: missing.length === 0 && output.missing_inputs.length === 0 ? 'pass' : 'fail',
      evidence: missing.length === 0 && output.missing_inputs.length === 0
        ? 'No required field or input remains missing.'
        : 'The user would need to supply missing fields or inputs.',
    },
  };
  const criterionResults = task.acceptance_criteria.map(({ criterion_id }) => ({ criterion_id, ...resultById[criterion_id]! }));
  return {
    variant_id: variant,
    status: 'success',
    output_parse_status: 'valid',
    duration_ms: durationMs,
    token_usage: usage,
    codex_exit_status: 'success',
    criterion_results: criterionResults,
    criterion_pass_count: criterionResults.filter(({ status }) => status === 'pass').length,
    criterion_fail_count: criterionResults.filter(({ status }) => status === 'fail').length,
    missing_required_fields: missing,
    output,
  };
}

export async function runExperimentBundle(input: {
  provider: ResearchProvider;
  task: ExperimentCatalogTask;
  timeoutMs: number;
  maximumOutputChars: number;
}): Promise<{ bundle: ExperimentBundle; calls: number; durationMs: number; usage: ExperimentResult['token_usage'] }> {
  const variants = ['baseline_chat_request', 'structured_task_card'] as const;
  const calls: Array<ResearchProviderCall<ExperimentOutput>> = [];
  for (const variant of variants) {
    const call = await input.provider.runExperiment({ variant, task: input.task });
    if (JSON.stringify(call.output).length > input.maximumOutputChars) {
      throw new ResearchProviderUnavailableError('codex_output_invalid');
    }
    calls.push(call);
  }
  const results = variants.map((variant, index) => {
    const call = calls[index]!;
    return evaluateExperimentOutput(input.task, variant, call.output, call.durationMs, call.usage);
  }) as [ExperimentResult & { variant_id: 'baseline_chat_request' }, ExperimentResult & { variant_id: 'structured_task_card' }];
  const baseline = results[0];
  const structured = results[1];
  const bundle = experimentBundleSchema.parse({
    spec: {
      task_id: input.task.task_id,
      type: input.task.type,
      input_sha256: sha256(input.task.synthetic_input),
      model: input.provider.modelName,
      timeout_ms: input.timeoutMs,
      variants: variants.map((variant) => ({ variant_id: variant, prompt_sha256: sha256(buildExperimentInput({ variant, task: input.task })) })),
    },
    results,
    observable_differences: [
      `Baseline passed ${baseline.criterion_pass_count} of ${baseline.criterion_results.length} criteria; structured passed ${structured.criterion_pass_count}.`,
      `Baseline missing fields: ${baseline.missing_required_fields.join(', ') || 'none'}; structured missing fields: ${structured.missing_required_fields.join(', ') || 'none'}.`,
      'The comparison records this sample only and does not estimate a universal efficiency or accuracy change.',
    ],
    limitations: [
      'Only one synthetic text-to-text sample was run.',
      'Each variant ran once, so normal model variability was not measured.',
      'The result cannot be generalized to every task, model, user, or agent workflow.',
    ],
  });
  const add = (field: keyof NonNullable<ExperimentResult['token_usage']>) => {
    const values = calls.map(({ usage }) => usage?.[field] ?? null);
    return values.every((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  };
  return {
    bundle,
    calls: 2,
    durationMs: calls.reduce((sum, call) => sum + call.durationMs, 0),
    usage: calls.every(({ usage }) => usage === null) ? null : {
      input_tokens: add('input_tokens'), output_tokens: add('output_tokens'), total_tokens: add('total_tokens'),
    },
  };
}
