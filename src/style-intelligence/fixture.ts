import type { CorpusDocument } from './types.js';
import { sha256 } from './hash.js';
import type { RightsStatus } from './schemas.js';
import type { StyleDistillationBundle, StyleDistillInput, StyleDistillProvider } from './provider.js';
import type { StyleQualitative } from './schemas.js';

const fixtureBodies = [
  '我先把任务跑了一遍。第一步打开设置，第二步保存结果。实测用了 12 分钟，失败时页面会保留原输入。',
  '如果你准备检查一条自动化，先看输入和交付物。比如这次测试有 3 个字段，少一个都会停止。',
  '我的判断很简单。工具能不能用，要看结果能否回读。数据显示 8 次测试里有 7 次通过，剩下一次保留了错误。',
  '教程从真实卡点开始。打开页面以后选择文件，再运行检查。最后保存一份能复查的报告。',
  '为什么这一步要单独检查？因为页面显示成功，不代表文件已经写入。实测时我会重新打开一次。',
  '上周我改了这套流程。原来需要 20 分钟，现在是 9 分钟。省下来的时间来自少填两张表。',
  '先准备 2 份测试材料，然后创建任务。遇到失败就记录原因，不要把未执行写成零结果。',
  '这份清单只解决一个场景。你可以照着检查输入、运行记录和最终文件，做完后再决定是否加入日常流程。',
];

export function buildStyleFixtureDocuments(options: {
  profileId?: string;
  profileType?: CorpusDocument['profile_type'];
  rightsStatus?: RightsStatus;
  count?: number;
} = {}): CorpusDocument[] {
  const profileId = options.profileId ?? 'fixture-owner';
  const profileType = options.profileType ?? 'owner_voice';
  const rightsStatus = options.rightsStatus ?? 'owned_by_user';
  const count = options.count ?? 8;
  return Array.from({ length: count }, (_, index) => {
    const text = fixtureBodies[index % fixtureBodies.length]!;
    return {
    document_id: `doc_${sha256(`${profileId}:${index}:${text}`).slice(0, 16)}`,
    profile_id: profileId,
    profile_type: profileType,
    rights_status: rightsStatus,
    platform: 'wechat',
    content_type: index % 2 === 0 ? 'tutorial' : 'analysis',
    title: `离线风格样本 ${index + 1}`,
    content_sha256: sha256(text),
    source: {
      creator_id: rightsStatus === 'public_reference' ? 'fixture-reference-creator' : 'fixture-owner-creator',
      creator_display_name: rightsStatus === 'public_reference' ? 'Fixture Reference' : 'Fixture Owner',
      canonical_url: `https://example.test/fixture/${profileId}/${index + 1}`,
      platform_item_id: `fixture-${profileId}-${index + 1}`,
      published_at: '2026-08-14T00:00:00.000Z',
      source_filename: 'generated-fixture',
    },
    rights: {
      basis: rightsStatus === 'public_reference' ? 'public_reference_analysis' as const : rightsStatus === 'licensed' ? 'explicit_license' as const : 'user_owned' as const,
      permission_reference: rightsStatus === 'public_reference' ? 'public-page-technique-analysis-only' : 'fixture-user-confirmation',
      confirmed_at: '2026-08-15T00:00:00.000Z',
    },
    model_processing: { allowed: true, provider_scope: 'codex_cli' as const, consent_recorded_at: '2026-08-15T00:00:00.000Z' },
    imported_at: '2026-08-15T00:00:00.000Z',
    text,
  };
  });
}

function qualitative(input: StyleDistillInput): StyleQualitative {
  const reference = input.rights_status === 'public_reference';
  return {
    voice_signals: ['先给可执行动作，再说明判断边界', '保留有依据的不确定表达'],
    structural_patterns: ['从用户任务进入，再给操作、验收与失败处理'],
    explanation_patterns: ['用数字或动作解释抽象判断'],
    evidence_patterns: ['把实测证据放在相邻判断附近'],
    cta_patterns: ['免费内容先完整交付，行动建议放在末段'],
    positive_rules: ['每段增加事实、动作、区别或后果', '正常列表服务教程任务'],
    anti_patterns: ['不制造焦虑', '不省略关键步骤'],
    preferred_terms: reference ? [] : ['实测', '回读', '验收'],
    content_pattern_profile: {
      topic_entries: ['从具体任务或卡点进入'],
      problem_definitions: ['把问题写成可观察的失败状态'],
      evidence_placement: ['证据靠近它支持的判断'],
      progression_patterns: ['任务、动作、结果、边界依次推进'],
      ending_patterns: ['结束在验收或下一步行动'],
    },
    language_style_profile: {
      rhythm_observations: ['长短句随信息密度变化'],
      first_person_usage: ['第一人称只承载真实操作或判断'],
      question_usage: ['问句用于真实读者疑问'],
      transition_patterns: ['用因果与动作衔接'],
      abstraction_and_action: ['动作词承担主要解释'],
      judgment_and_uncertainty: ['判断给出依据和适用边界'],
      humor_and_asides: ['不额外制造笑料'],
    },
    conversion_pattern_profile: {
      cta_positions: ['CTA 位于完整交付之后'],
      cta_length_patterns: ['CTA 保持简短'],
      free_value_completeness: ['免费内容包含关键验收步骤'],
      product_connections: ['只连接已核准的产品能力'],
      anxiety_patterns: ['不靠焦虑推动转化'],
      omitted_step_patterns: ['不省略决定结果的操作'],
    },
    confidence: 0.78,
  };
}

export class FixtureStyleProvider implements StyleDistillProvider {
  readonly providerName = 'fixture' as const;
  distillCalls = 0;
  repairCalls = 0;
  private bundle(input: StyleDistillInput): StyleDistillationBundle {
    const reference = input.rights_status === 'public_reference';
    return {
      profile_fragment: qualitative(input),
      protected_transfer_candidates: reference ? [{
        kind: 'signature_phrase',
        text: '页面会保留原输入',
        source_document_ids: input.documents.slice(0, 1).map(({ document_id }) => document_id),
        extraction_reason: 'deterministic fixture exact phrase',
      }] : [],
    };
  }
  async distill(input: StyleDistillInput): Promise<StyleDistillationBundle> { this.distillCalls += 1; return this.bundle(input); }
  async repair(input: StyleDistillInput, _validationErrors: string[]): Promise<StyleDistillationBundle> { this.repairCalls += 1; return this.bundle(input); }
}
