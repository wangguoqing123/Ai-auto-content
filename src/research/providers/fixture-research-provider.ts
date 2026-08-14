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
  if (first === undefined) throw new Error('Fixture research requires at least one source');
  const claims = input.topic.supported_claims.map((topicClaim, index) => {
    const source = input.sources.find(({ material_id }) => topicClaim.fact_source_ids.includes(material_id));
    const segment = source?.segments.find(({ segment_id }) => segment_id === 'p0002') ?? source?.segments[0];
    if (source === undefined || segment === undefined) return {
      claim_id: `claim_supported_${index + 1}`,
      claim: topicClaim.claim,
      support_status: 'unsupported' as const,
      source_id: null,
      segment_id: null,
      quote: '',
      scope_limit: 'The assigned fact source was unavailable.',
      notes: 'Fixture evidence gap.',
    };
    return {
      claim_id: `claim_supported_${index + 1}`,
      claim: topicClaim.claim,
      support_status: 'direct' as const,
      source_id: source.source_id,
      segment_id: segment.segment_id,
      quote: segment.text,
      scope_limit: source.content_scope === 'feed_excerpt'
        ? 'Only the official RSS item excerpt was available; full article details were not verified.' : '',
      notes: source.content_scope === 'feed_excerpt'
        ? 'Fixture exact quote from the persisted official RSS excerpt.' : 'Fixture exact quote.',
    };
  });
  const questions = input.topic.research_questions;
  return {
    verified_claims: claims,
    research_answers: questions.map((question, index) => index < 2 && claims[index]?.support_status !== 'unsupported' ? {
      question,
      answer_status: 'partial' as const,
      gap_impact: 'blocking' as const,
      answer: index === 0
        ? 'The official RSS excerpt says the research covers agentic AI adoption using ChatGPT and Codex.'
        : 'The official RSS excerpt says the case covers AI product development and centralized operational intelligence across engineering and operations.',
      supporting_claim_ids: [`claim_supported_${index + 1}`],
      remaining_gap: 'Only the official RSS item excerpt was verified; the full article details needed to answer the question are unavailable.',
    } : {
      question,
      answer_status: 'unanswered' as const,
      gap_impact: 'blocking' as const,
      answer: '',
      supporting_claim_ids: [],
      remaining_gap: index < 2
        ? 'The assigned fact source is unavailable.'
        : 'The supplied official RSS excerpts do not compare candidate demonstration tasks.',
    }),
    experiment_task_id: input.topic.requires_experiment ? 'public_notes_to_action_brief' : null,
    experiment_rationale: input.topic.requires_experiment ? 'The synthetic public-notes task is bounded and text-only.' : '',
    writing_requirements: {
      main_promise: input.topic.one_sentence_promise,
      minimum_result: input.topic.minimum_result,
      required_claim_ids: claims.filter(({ support_status }) => support_status !== 'unsupported').map(({ claim_id }) => claim_id),
      required_disclosures: [
        'The factual evidence is limited to official RSS item excerpts, not full article content.',
        'The experiment uses one synthetic sample and cannot be generalized.',
      ],
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
