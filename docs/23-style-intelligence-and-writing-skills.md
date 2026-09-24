---
title: 写作 Skill 编排与风格智能 v0
version: 1.2.0
updated_at: 2026-08-15
status: implemented_live_provider_verified_pending_real_corpus
---

# 写作 Skill 编排与风格智能 v0

## PR #8 Approval Chain 与 Writer 边界

当前私有 Profile 已由用户确认为 Provisional，但仍不是 production。Legacy Receipt 通过 `approval-binding-attestation.v1.json` 绑定 Profile 与 Summary；该 Attestation 只补齐旧 Receipt 缺少 Profile Hash 的技术链，不要求重新填写审批表，也不代表重新审批。

Resolver 验证完成后只给 Writer 一个 WeakMap 保护的、筛选后 Style 句柄。`OCV-09`、`CON-05` 关闭，`OCV-10` deleted；Pending、deleted 和 210 条原始规则都不进入模型。Owner Scope 是 `owner_shortform_social_proxy`；公众号不能声称已经学会七天假的长文风格。

human-writing 的 pre-draft 只含材料门槛、说话位置、中文正向写法、文章推进与当前文体结构；revision rules 只在初稿后加载。no-ai-slop 只返回 detect-only issue，Quality Reviewer 同样不能返回全文。一次 Repair 只修改命中 Block，之后重跑全部确定性检查，最多 3 次 Codex 调用。

本阶段只建立写作前的规则、风格和审查底盘。离线 CI 继续只使用合成 Fixture；另在用户明确授权下，以项目自有合成语料完成了一次本机真实 Codex Provider 集成验证。仍未导入七天假或参考作者的真实语料，没有生成公众号正文、X 内容或图片，也没有发布。

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

目录固定 `0700`，文件固定 `0600`。Corpus Root 和 Source File 都会在创建或读取时逐级 `lstat`、拒绝 symlink，再用 `realpath` 确认真实位置不在当前 Git worktree 或 `.git` 内；Corpus 内的 registry、owner、references、feedback、cache 和 protected 文件也会在每次读取时复验，目录、FIFO、device、socket 等都不能冒充普通 Source File。每篇 `CorpusDocument` 除正文、Profile、平台和内容类型外，还必须记录：

- `content_sha256`
- `source.creator_id`、`creator_display_name`、`canonical_url`、`platform_item_id`、`published_at`、`source_filename`
- `rights.basis`、`permission_reference`、`confirmed_at`
- `model_processing.allowed`、`provider_scope`、`consent_recorded_at`

`owned_by_user` 只接受 `user_owned`；`licensed` 只接受 `explicit_license`；`public_reference` 只接受 `public_reference_analysis`，且必须有 creator、HTTP(S) URL、平台，并只能生成 `reference_technique`。

`model_processing.allowed` 必须在导入时明确传 `allowed` 或 `denied`，没有默认 true。权利声明与模型授权只能来自用户执行的 CLI 参数或可信本地 Manifest；待分析 JSONL 不能提供或覆盖 `rights`、`model_processing`、consent、permission reference 或 rights basis，出现这些顶层字段会直接拒绝。JSONL 只允许逐篇覆盖标题、正文、平台、内容类型和经过 Corpus Schema 验证的 source 元数据。相同 Profile 内，重复 `content_sha256` 或相同 `canonical_url + platform_item_id` 不会重复导入，也不会增加 sample count。

本机 Codex CLI 不是离线模型。只有同一 Profile 的每一篇语料都明确 `allowed` 且 `provider_scope=codex_cli`，才会作为模型输入发送给 Codex 服务；程序不输出认证信息。任一文档为 denied 时，整个 Profile 都不会初始化 Provider，也不会读取 `STYLE_CODEX_MODEL`、解析 Codex 路径、执行版本/帮助/登录探测或要求本机安装和登录 Codex；只计算本地确定性指标，输出 `processing_not_allowed`、`model_calls=0`，不能进入正式 Recipe。

## 4. 输入预算与 Profile 内容审计

确定性输入预算为最多 30 篇、每篇 12,000 字符、合计 240,000 字符。超限时从文档集合及每篇正文的开头、中段、结尾确定性取样，标题单独保留，因此结尾 CTA 位置仍在输入中。Profile 记录逐篇和汇总的原始字符、提交字符、覆盖率和截断状态；`corpus_hash` 基于完整原文，`model_input_hash` 基于实际模型输入。覆盖率下降时，confidence 上限同步下降。

`evidence_distance` 先在每篇文档内部计算，再按有效判断数量加权；上一篇的数字不会被当成下一篇判断的证据。

Public Reference Profile 只保存抽象 structure、explanation、evidence placement 和 CTA 技巧，不保存 voice、preferred terms、身份、经历、事实、原句、口头禅或专属比喻。Owner Profile 也拒绝 URL、年份事件、金额或收入、客户/学员故事、未抽象的个人事件、原文长句和具体事实数字。内容审计失败时最多 Repair 一次，Repair 后仍有事实就终止 Profile 生成。

## 5. Protected Transfer Index

每个 Public Reference Profile 的本机 Reviewer Index 保存到 `cache/protected/<profile_id>.protected.json`。同一次 Distill 的严格 Bundle 同时返回抽象 Profile Fragment 和 Protected Candidates，不增加第三次模型调用；Owner/Licensed Bundle 的候选必须为空。条目可标记 `signature_phrase`、`unique_metaphor`、`personal_experience_entity` 或 `distinctive_short_fragment`。模型声明的来源 ID 只是提示，代码会重扫完整 Profile Corpus，确认 `text` 是原文连续精确子串，重算所有真实来源并稳定排序；口头禅至少含 4 个中文字符。

`style:distill` 会先以同目录临时文件、`0600`、fsync 和 atomic rename 自动写 Index，再写 Profile。匹配 `profile_id + corpus_hash` 的旧 Index 可复用，Corpus 变化则自动重建；Profile 与 Index 共用 `computeStyleCorpusHash()`，成功的 Public Reference Profile 得到 `protected_index_status=ready`。

Protected Index 只供 plagiarism Reviewer 使用，绝不进入 Style Profile、Style Recipe、Writer Prompt 或 Git。生产 Guard 只接受 Resolver 生成的不可伪造 `ResolvedProtectedTransferIndexes`。`style:lint` 对每个 Public Reference Profile 检查正确路径、0600、非 symlink、严格 Schema、profile ID 和完整 corpus hash；缺失、过期、损坏或不安全分别以 `protected_index_missing`、`protected_index_stale`、`protected_index_invalid`、`protected_index_insecure` 非零退出，不会继续一个不完整的检查。Fixture bypass 必须显式调用。Inspect 只输出 hash、时间、状态和各类数量，不输出短语正文。

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
npm run style:protected:inspect -- --profile-id <id>
npm run style:lint -- --fixture
npm run style:lint -- --draft <file> --research-pack <ready-pack.json>
```

## Synthetic live Codex integration validation

2026-08-15 在 PR 执行前 Head `b9c4df754075fc1ebc2a02dc94be1069a291ccd0` 上完成一次获准的合成 live 集成验证：使用 `/Users/wangguoqing/.local/bin/codex`（`codex-cli 0.147.0`）、模型 `gpt-5.6-sol` 和独立 `/tmp` Corpus。环境显式清除 `OPENAI_API_KEY`、`GH_TOKEN` 与 `GITHUB_TOKEN`，没有访问 X、公众号、Browser Bridge 或网页。

| 验证项 | 安全摘要 |
|---|---|
| 合成 Corpus | Owner 8 篇；Public Reference 8 篇；每篇 500～900 个汉字；Owner 重复导入为 0 |
| Owner Distill | 外层命令 1 次；内部 Codex 1 次；Profile `ready`；Index `not_required` |
| Reference Distill | 外层命令 1 次；内部 Codex 1 次；Profile `ready`；Index `ready` |
| Protected Index | `signature_phrase=2`、`unique_metaphor=1`、`personal_experience_entity=1`、`distinctive_short_fragment=1`；Profile/Index corpus hash 一致 |
| Style Recipe | baseline 0、owner 0.80、reference 0.20、platform 0；Owner rules 10、Reference rules 2；Reference voice rules 0 |
| 正常 Lint | `pass`；0 blocker；“学习闭环”保留为 1 条 warning |
| Protected Guard | `distinctive_short_fragment` 成功触发 `signature_phrase_transfer` hard blocker；摘要未输出 Entry text |
| stale Resolver | 返回 `protected_index_stale`，未继续 Guard |

Profile、Protected Index、合成文章、Codex 结果和一次性脚本均只存在于临时目录，没有进入 Git；临时结果未检出 Secret 或认证值。此次验证只证明真实 `codex_cli` 链路已接通，不代表已经学习七天假风格，也不把风格智能标为 production。系统状态为 `implemented_live_provider_verified_pending_real_corpus`。

真实语料导入前仍需要用户通过 CLI 或可信本地 Manifest 提供每篇来源、权利依据和明确的模型处理授权；Public Reference Index 会在获准 Distill 时自动生成，不再要求手写 JSON。当前仍未导入任何七天假或参考作者真实语料。满足这些输入条件不等于自动生成或发布内容；PR #8 仍需单独接入写作和人工确认。
