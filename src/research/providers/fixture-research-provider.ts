import type { ExperimentOutput, ResearchProviderResult } from '../schemas.js';
import type {
  ResearchExperimentInput,
  ResearchProvider,
  ResearchProviderCall,
  ResearchProviderInput,
} from './research-provider.js';

function call<T>(output: T): ResearchProviderCall<T> {
  return { output, durationMs: 1, usage: null };
}

function result(input: ResearchProviderInput): ResearchProviderResult {
  const first = input.sources[0];
  const second = input.sources[1] ?? first;
  if (first === undefined || second === undefined) throw new Error('Fixture research requires two sources');
  const firstSegment = first.segments[0];
  const secondSegment = second.segments[0];
  if (firstSegment === undefined || secondSegment === undefined) throw new Error('Fixture sources require segments');
  const questions = input.topic.research_questions;
  return {
    verified_claims: [
      {
        claim_id: 'claim_supported_1',
        claim: input.topic.supported_claims[0]?.claim ?? 'Official material describes multi-step execution under oversight.',
        support_status: 'direct',
        source_id: first.source_id,
        segment_id: firstSegment.segment_id,
        quote: firstSegment.text,
        scope_limit: '',
        notes: 'Fixture direct quote.',
      },
      {
        claim_id: 'claim_supported_2',
        claim: input.topic.supported_claims[1]?.claim ?? 'RingCentral describes organizing engineering and operational work.',
        support_status: 'direct',
        source_id: second.source_id,
        segment_id: secondSegment.segment_id,
        quote: secondSegment.text,
        scope_limit: '',
        notes: 'Fixture direct quote.',
      },
    ],
    research_answers: questions.map((question, index) => ({
      question,
      answer_status: 'answered' as const,
      answer: index === 0
        ? 'The supplied official material describes bounded multi-step execution with explicit oversight.'
        : index === 1
          ? 'The case can be abstracted into explicit inputs, owned actions, and checkable completion conditions.'
          : 'A synthetic notes-to-action-brief task is non-sensitive and supports itemized acceptance.',
      supporting_claim_ids: [index === 1 ? 'claim_supported_2' : 'claim_supported_1'],
      remaining_gap: '',
    })),
    experiment_task_id: input.topic.requires_experiment ? 'public_notes_to_action_brief' : null,
    experiment_rationale: input.topic.requires_experiment ? 'The synthetic public-notes task is bounded and text-only.' : '',
    writing_requirements: {
      main_promise: input.topic.one_sentence_promise,
      minimum_result: input.topic.minimum_result,
      required_claim_ids: ['claim_supported_1', 'claim_supported_2'],
      required_disclosures: ['The experiment uses one synthetic sample and cannot be generalized.'],
      forbidden_claims: ['Do not claim a universal speed or accuracy improvement.', 'Do not invent first-person long-term testing.'],
      required_visual_evidence: ['Show both task inputs, both outputs, and the shared acceptance checklist.'],
    },
  };
}

function baselineOutput(): ExperimentOutput {
  return {
    deliverable: {
      title: 'Action brief',
      objective: 'Prepare the handout.',
      decisions: [],
      actions: [],
      acceptance_checklist: [],
      risks: [],
    },
    assumptions: ['The owner and deadline can be decided later.'],
    missing_inputs: ['Owners and acceptance checks were not explicit in the request.'],
    steps_taken: ['Summarized the request.'],
    self_check: [],
  };
}

function structuredOutput(): ExperimentOutput {
  return {
    deliverable: {
      title: 'Community AI practice handout action brief',
      objective: 'Publish an offline one-page practice handout next Tuesday.',
      decisions: ['Use only synthetic examples.', 'The handout must work without account login.'],
      actions: [
        { task: 'Draft the outline', owner: 'Lin', next_step: 'Prepare the outline by Friday', acceptance_condition: 'Outline fits the one-page handout structure.' },
        { task: 'Create the example', owner: 'Chen', next_step: 'Add a synthetic example', acceptance_condition: 'Example contains no private data and works offline.' },
        { task: 'Run final check', owner: 'Qiao', next_step: 'Check every item before Tuesday', acceptance_condition: 'Every checklist item has pass or fail evidence.' },
      ],
      acceptance_checklist: ['One page maximum.', 'Works without account login.', 'Includes a pass/fail checklist.'],
      risks: ['The example may exceed one page.', 'The example could accidentally depend on an online account.'],
    },
    assumptions: [],
    missing_inputs: [],
    steps_taken: ['Extracted constraints.', 'Mapped owners and next steps.', 'Built acceptance checks.', 'Recorded risks.', 'Ran self-check.'],
    self_check: [
      { criterion_id: 'deliverable_present', status: 'pass', evidence: 'Action brief is present.' },
      { criterion_id: 'required_fields_complete', status: 'pass', evidence: 'All required fields are populated.' },
      { criterion_id: 'missing_inputs_explicit', status: 'pass', evidence: 'No missing inputs remain.' },
      { criterion_id: 'executable_next_steps', status: 'pass', evidence: 'Each action has owner, next step, and acceptance.' },
      { criterion_id: 'acceptance_mapped', status: 'pass', evidence: 'Checklist maps to the stated constraints.' },
      { criterion_id: 'assumptions_bounded', status: 'pass', evidence: 'No unsupported assumptions were added.' },
      { criterion_id: 'strict_output_format', status: 'pass', evidence: 'Shared structure is complete.' },
      { criterion_id: 'no_major_supplementation', status: 'pass', evidence: 'The deliverable can be checked as written.' },
    ],
  };
}

export class FixtureResearchProvider implements ResearchProvider {
  readonly providerName = 'fixture';
  readonly modelName = 'offline-fixture';
  readonly runtimeVersion = 'fixture-v1';
  readonly timeoutMs = 20_000;
  readonly experimentCalls: Array<ResearchExperimentInput['variant']> = [];

  async analyze(input: ResearchProviderInput) {
    return call(result(input));
  }

  async repair(input: ResearchProviderInput, _validationErrors: string[]) {
    return call(result(input));
  }

  async runExperiment(input: ResearchExperimentInput) {
    this.experimentCalls.push(input.variant);
    return call(input.variant === 'baseline_chat_request' ? baselineOutput() : structuredOutput());
  }
}
