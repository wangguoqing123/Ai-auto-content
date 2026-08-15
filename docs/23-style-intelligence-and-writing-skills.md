---
title: 写作 Skill 编排与风格智能 v0
version: 1.1.0
updated_at: 2026-08-15
status: implemented_pending_real_corpus
---

# 写作 Skill 编排与风格智能 v0

本阶段只建立写作前的规则、风格和审查底盘。当前验收全部使用合成 Fixture：没有导入七天假或参考作者的真实语料，没有调用真实 Codex，没有生成公众号正文、X 内容或图片，也没有发布。

## 1. 固定 Skill 与可审计适配

| Skill | 固定版本 | 职责 |
|---|---|---|
| `human-writing` | `1.1.0` / `4fda173f3fef7fb808f3eba991eeb2528ea4b189` | 材料门槛、中文正向写法、事实边界和初稿后修订 |
| `no-ai-slop` | `d30eddb9e04562234f2070b5ee63ca4649d9a05e` | 初稿后的 detect-only 审查和最小有效修改 |

上游文件、MIT License、commit 和逐文件 SHA-256 固定在 `third_party/writing-skills/manifest.yaml`。`adaptation-map.yaml` 再把每个内部规则映射到 Skill commit、已固定的来源文件、章节、适配方式和严重度。项目自建规则必须标成 `project_override`，不能伪装成第三方规则。

Adapter 只消费审计后的内部映射，不会在运行时把上游 `SKILL.md` 或 `eval.md` 当成 Prompt 执行，也不依赖全局 Skill 安装。每个 `WritingIssue` 都保存 `rule_origin` 与 `source_commit`。

## 2. 编排边界

human-writing 在第一稿前只提供材料门槛、说话位置、当前文体结构和正向规则；详细 revision rules 只能在初稿后使用。no-ai-slop 不生成第一稿，只返回定位明确的 Issue，不全文重写，也不新增事实、案例、观点或个人经历。

事实和硬约束优先于风格：Research 证据、Persona、Product Claim、平台规则、Owner Profile、当前 Recipe、human-writing、no-ai-slop 依次降级。风格规则不能改写事实。

## 3. Corpus 来源、权利与模型处理授权

默认私有目录：

```text
~/Library/Application Support/AiAutoContent/style-corpus/
├── sources.local.yaml
├── owner/
├── references/
├── feedback/
└── cache/
    └── protected/
```

目录固定 `0700`，文件固定 `0600`，并且 corpus root 必须在 Git 仓库外。每篇 `CorpusDocument` 除正文、Profile、平台和内容类型外，还必须记录：

- `content_sha256`
- `source.creator_id`、`creator_display_name`、`canonical_url`、`platform_item_id`、`published_at`、`source_filename`
- `rights.basis`、`permission_reference`、`confirmed_at`
- `model_processing.allowed`、`provider_scope`、`consent_recorded_at`

`owned_by_user` 只接受 `user_owned`；`licensed` 只接受 `explicit_license`；`public_reference` 只接受 `public_reference_analysis`，且必须有 creator、HTTP(S) URL、平台，并只能生成 `reference_technique`。

`model_processing.allowed` 必须在导入时明确传 `allowed` 或 `denied`，没有默认 true。JSONL 可以逐条覆盖 source、rights 和 model-processing 元数据。相同 Profile 内，重复 `content_sha256` 或相同 `canonical_url + platform_item_id` 不会重复导入，也不会增加 sample count。

本机 Codex CLI 不是离线模型。只有明确 `allowed` 且 `provider_scope=codex_cli` 的语料，才会作为模型输入发送给 Codex 服务；程序不输出认证信息。任一文档为 denied 时，蒸馏不调用 Provider，只计算本地确定性指标，Profile 状态为 `processing_not_allowed`，不能进入正式 Recipe。

## 4. 输入预算与 Profile 内容审计

确定性输入预算为最多 30 篇、每篇 12,000 字符、合计 240,000 字符。超限时从文档集合及每篇正文的开头、中段、结尾确定性取样，标题单独保留，因此结尾 CTA 位置仍在输入中。Profile 记录逐篇和汇总的原始字符、提交字符、覆盖率和截断状态；`corpus_hash` 基于完整原文，`model_input_hash` 基于实际模型输入。覆盖率下降时，confidence 上限同步下降。

`evidence_distance` 先在每篇文档内部计算，再按有效判断数量加权；上一篇的数字不会被当成下一篇判断的证据。

Public Reference Profile 只保存抽象 structure、explanation、evidence placement 和 CTA 技巧，不保存 voice、preferred terms、身份、经历、事实、原句、口头禅或专属比喻。Owner Profile 也拒绝 URL、年份事件、金额或收入、客户/学员故事、未抽象的个人事件、原文长句和具体事实数字。内容审计失败时最多 Repair 一次，Repair 后仍有事实就终止 Profile 生成。

## 5. Protected Transfer Index

每个 Public Reference Profile 的本机 Reviewer Index 保存到 `cache/protected/<profile_id>.protected.json`。条目可标记 `signature_phrase`、`unique_metaphor`、`personal_experience_entity` 或 `distinctive_short_fragment`，必须记录来源文档，并由代码确认 `text` 是原文连续精确子串；口头禅至少含 4 个中文字符。

Protected Index 只供 plagiarism Reviewer 使用，绝不进入 Style Profile、Style Recipe、Writer Prompt 或 Git。Guard 自动加载当前公共参考 Profile 对应的 Index，检查短口头禅、专属比喻、个人实体和独特短片段。缺 Index 的公共 Reference Profile 只能用于 Fixture 或 metrics-only，不能进入正式写作 Recipe。

## 6. Style Recipe：权重真实选择规则

`selected_rules` 是 Recipe 的唯一事实源。每条规则都含 `rule_id`、category、text、`source_role`、`source_profile_id`、`source_weight` 和 `selection_reason`；便捷数组完全由它派生。

有 Owner 时：

```text
owner_weight = 1 - reference_total - platform_weight
owner_weight >= 0.60
reference_total <= 0.30
each_reference <= 0.20
platform_weight <= 0.15
baseline_weight = 0
```

没有 Owner 时，Reference 必须为空，`baseline_weight = 1 - platform_weight`，且不能声称已学习七天假声音。Platform 仍可贡献组织、格式、长度与阅读规则，但永远不能贡献 voice。

选择器按来源权重计算确定性配额，再做确定性交错；非零 Reference 和 Platform 只要有可用规则就至少进入一条。改变权重会改变配额或顺序，而不只是改元数据。Reference 不提供 voice、个人经历、身份或 preferred terms。所有权重以 `1e-9` 容差检查总和为 1，相同输入稳定产生相同 `recipe_hash`。

## 7. Research Quote 严格授权

Plagiarism Guard 不接受调用者自由构造的 `claim_id + quote`。`style:lint --research-pack <path>` 先用 `researchPackSchema` 验证 Pack，只有 `status=success`、`decision=READY_FOR_WRITING`、存在的 direct Claim（或明确允许的 partial）、非空且完全一致的 quote/source_id/segment_id，才能生成不可伪造且运行时复验的内部豁免对象。

即使通过授权，quote 仍必须在公开正文中放在中文/英文引号或 Markdown 引用块内；把引用改成作者自己的叙述不会豁免。没有 `--research-pack` 时没有任何 Quote 豁免。

## 8. Lint 的能力边界

Raw Markdown Lint 不做不可靠的指代消解。“工具、应用、平台、系统”同时出现不再触发 `synonym_cycling`。只有结构化 `EntityNamingAudit` 已确认同一个 `entity_id` 在相邻内容块无原因换名，才会 blocking。

`商业闭环`、`价值闭环`、`迭代闭环`、`赋能`、`组合拳`、`降本增效` 是 blocking；`学习闭环`、`反馈闭环`、`执行闭环`、`颗粒度`、`协同`、`方法论` 默认只是 warning，需要结合是否替代了具体动作与结果判断。完全相同段落的 Issue 名为 `exact_duplicate_paragraph`，不声称能检测语义重复。

代码、URL、Markdown 元数据、来源字段和正常教程列表继续排除机械误报。

## 9. 三次一致反馈

反馈保存 writing pack、写作输入 hash、初稿 hash、Profile ID/版本、change signature，以及结构化 accepted/rejected change。Proposal 不是按 reason labels 凑三次，而是要求：

- 同一 `change_signature` 至少被接受 3 次
- 来自至少 3 个不同 `writing_pack_id` 和 3 个不同 `draft_hash`
- 平台一致
- article type 一致，或每条都明确 `cross_type`
- 同一 signature 没有任何 rejection

Proposal 保存 `supporting_feedback_ids` 和 `conflict_count=0`，状态仍是 `proposal_only`，不会自动修改 Profile。

## 10. 命令边界

```bash
npm run writing-skills:check
npm run style:import -- \
  --source <file> --profile-id <id> --profile-type owner_voice --rights-status owned_by_user \
  --platform wechat --content-type tutorial --creator-id <id> --creator-name <name> \
  --platform-item-id <id> --published-at <iso> --rights-basis user_owned \
  --permission-reference <record> --rights-confirmed-at <iso> \
  --model-processing allowed --consent-recorded-at <iso>
npm run style:inspect
npm run style:distill -- --fixture
npm run style:lint -- --fixture
npm run style:lint -- --draft <file> --research-pack <ready-pack.json>
```

真实语料导入前仍需要用户提供每篇来源、权利依据和明确的模型处理授权，并为每个公共 Reference Profile 建好经精确子串验证的 Protected Index。满足这些输入条件不等于自动生成或发布内容；PR #8 仍需单独接入写作和人工确认。
