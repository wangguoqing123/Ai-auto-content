---
title: 基于证据、已批准风格规则与 Human Send Gate 的写作包
version: 1.0.0
updated_at: 2026-08-20
status: implemented_pending_live_validation
---

# Evidence-constrained Writing Pack v0

## 1. 固定执行顺序

写作入口首先读取 `data/research-packs/YYYY-MM-DD/research-pack.json`。缺失或 failed 返回 `WAITING_FOR_RESEARCH`，`NO_TOPIC` 返回 `NO_CONTENT`，`RESEARCH_INCOMPLETE` 返回 `BLOCKED_BY_RESEARCH`。这三条路径的 `model.calls=0`，不会读取 Style 文件、模型环境变量或初始化 Codex。

只有 `READY_FOR_WRITING` 才进入：Style Approval Chain Resolver → Resolved Writing Style → 双平台 Style Recipe → Writer → 代码审计 → human-writing Lint → no-ai-slop detect-only → Quality Reviewer → 至多一次 Block Repair → 全部确定性检查重跑 → Plagiarism / Protected Transfer Guard → `READY_FOR_HUMAN_REVIEW`。

业务决定只有：`READY_FOR_HUMAN_REVIEW`、`BLOCKED_BY_RESEARCH`、`NO_CONTENT`、`WAITING_FOR_RESEARCH`、`WAITING_FOR_APPROVED_STYLE`。基础设施、审批链、模型、审计与 Guard 故障使用 `status=failed, decision=null`。

## 2. Approval Chain 与不可伪造 Style

Resolver 支持两种链：Receipt v2 直接绑定 `provisional_profile_sha256`；Receipt v1 必须同时提供 `approval-binding-attestation.v1.json`。Legacy Binding 只修复旧 Receipt 缺少 Profile Hash 的技术缺口，不代表重新审批或 production approved。

Resolver 在只读打开文件前核对仓库外边界、固定 calibration/provisional 目录、普通文件、无 symlink 和 `0600` 权限，再验证 Receipt、Profile、Summary、Decision Set、28 项决定、Owner/Reference 原始 Profile Hash、关闭/删除规则、`semantic_changes=false` 与 `user_reapproval_required=false`。

当前链状态为 `valid_legacy_receipt_with_binding_attestation`。`OCV-09` 与 `CON-05` 保持关闭，`OCV-10` 为 deleted。删除 ID 只存在于 Writing Pack 的安全审计字段，绝不进入 Writer、Reviewer、Recipe 或公开正文。

`ResolvedWritingStyle` 使用 WeakMap 句柄。Writer 不接收原始 Provisional Profile、Receipt、Attestation、Approval Summary、审批表、blind map、完整规则库、Reference Corpus 或 Protected Entry。

## 3. Provisional 生命周期

Provisional Profile 只能用于显式授权的 `--dry-run` 或 `--synthetic-ready-fixture`，且必须传入：

```bash
--style-profile <path>
--approval-receipt <path>
--binding-attestation <path>
--allow-provisional-style
```

缺少任一参数或正式模式尝试消费 Provisional 时返回 `WAITING_FOR_APPROVED_STYLE`，`model.calls=0`。Scheduler 不传这些参数，只接受未来的 approved Profile。Provisional 结果固定 `production_eligible=false`、`human_gate.required=true`、`automated_publish_allowed=false`，只写 `/tmp` 或本机 0700/0600 审阅目录，不写正式数据或创建 Git commit。

## 4. Style Recipe 与平台范围

Owner 语料当前只是 `owner_shortform_social_proxy`，`platform_fidelity=proxy`、`confidence=medium`。它可以贡献声音、判断、解释倾向、不确定性、第一人称倾向和受限节奏/词汇偏好；不能声称已经学会七天假的原生 X 互动方式或公众号长文结构。

公众号初始权重为 Owner 0.65、Reference 0.20、WeChat Platform 0.15；X 为 Owner 1.00。Reference 只贡献结构、解释、证据位置、CTA 技巧和免费价值完整度，不贡献 voice、preferred terms、身份、经历、事实、标志短语或专属比喻。教程、分析、案例拆解、观点和清单分别使用动态结构，只有教程与清单强制步骤。

## 5. Blocks、平台产物与审计

母稿以 `ContentBlock` 保存 block type、正文、Claim、实验、产品、人物事实与 Style Rule 引用。代码从同一组 Blocks 渲染一篇 1200–2400 汉字的公众号文章和一个由 Research plan 决定的 X 格式。公众号标题总数固定为 3；X 只保留 `single_post`、`thread` 或 `debate_prompt` 中的一种。

Evidence Audit 只接受 `verified_claims`：direct 可作事实，partial 必须写“目前能确认的是”并保留 scope，unsupported 禁止进入内容，全部 required Claims 必须使用。Experiment Audit 只读已保存结果并保留单样例、单次运行、未测波动和不可外推边界。Product Audit 不升级 CTA，CON-05 关闭时只允许无产品承接的 none/light 行动，公开价格默认关闭。First-person Audit 允许有标记的观点型“我”，拒绝无人物或项目证据的事实型经历。

human-writing 在初稿前只提供材料门槛、说话位置、中文正向规则和文体推进；初稿后才提供 revision/lint。no-ai-slop 永远是 detect-only，Reviewer 不返回全文。Writer、Reviewer、一次 Block Repair 合计最多 3 次调用；Repair 不能修改未命中 Block，也不能新增事实、权益、经历、案例或实验结果。

最终 Guard 在模型完成后才以只读方式加载 Reference Corpus、Protected Transfer Index 与授权 Research Quotes，检查连续重合、中文 12-gram、signature phrase、unique metaphor、personal experience entity 和 distinctive fragment。Guard 命中后 fail closed，不通过替换几个词自动放行，审计输出也不保存 Protected Entry 正文。

## 6. Visual Slots 与 Human Send Gate

本阶段只规划 `cover`、`process_diagram`、`checklist`、`comparison`、`screenshot`、`result_card`。所有 Slot 的 `generation_status=not_started`，不生成图片 Prompt、不调用图片模型。

`READY_FOR_HUMAN_REVIEW` 只代表母稿、公众号、X 和全部审计通过，仍要求人工检查并手动发送。系统不接入公众号草稿箱、X 发布、点赞、评论、关注、转发、私信或发布后复盘，也不以规避平台检测为目标。

## 7. 命令

```bash
npm run writing:build -- --fixture --date=2026-08-14
npm run writing:build -- --dry-run --synthetic-ready-fixture \
  --style-profile <profile> \
  --approval-receipt <receipt> \
  --binding-attestation <attestation> \
  --allow-provisional-style
npm run writing:validate -- <writing-pack>
npm run writing:inspect -- --date=YYYY-MM-DD
```

2026-08-14 的正式 Research Pack 为 `RESEARCH_INCOMPLETE`，所以正式阻塞验证应返回 `status=success`、`decision=BLOCKED_BY_RESEARCH`、`model.calls=0`，且不读 Style、不初始化 Codex、不产生正文。

## 8. 2026-08-18 Synthetic READY live 结果

在最新代码、Fixture 与 PR CI 通过后执行了一次真实本机 Codex dry-run。Writer、Reviewer、一次 Repair 共 3 次调用；初稿为 1629 个汉字、3 个公众号标题和一个 5 条 thread。Repair 后 Evidence、Experiment、Product、First-person Audit 均通过，所有 Research disclosure 与 experiment limitation 已补齐。

最终 Style Audit 仍 fail closed：旧 lint 每类只暴露第一处翻案腔，Repair 修复首处后第二处才出现。系统返回 `status=failed`、`decision=null`、`error_code=writing_audit_failed`，没有生成 Writing Pack 正文输出或本机效果审阅包。该覆盖缺陷随后用离线复盘修复为一次报告同类全部命中，并增加回归测试；遵守“一次真实 dry-run”的授权边界，没有再次调用 Codex。因此当前状态仍是 `implemented_pending_live_validation`，尚不满足 Provisional Profile 写作效果审核条件。

## Second authorized Synthetic READY live validation

- 执行前 Head：`63883aadce678f435f78c1e045a27e3d88953887`
- 实际 writing dry-run 次数：1
- 最新 Lint 行为：Repair 前一次报告 4 处 `reversal_rhetoric`；human-writing 与 no-ai-slop 都对同类全部命中
- Codex：`codex-cli 0.147.0` / `gpt-5.6-sol`，Writer、Reviewer、Repair 共 3 次调用，模型总耗时 143424 ms；命令墙钟时间 144 秒
- Repair：已执行，3 个 targets，均为命中的 Content Blocks：`block_boundary`、`block_step_owner_deadline`、`block_step_acceptance`
- 修复后公众号：1567 个汉字、3 个标题
- X：单一 `thread`，5 条
- Audit：Evidence `pass`、Experiment `pass`、Product `pass`、First-person `pass`、Style `blocked`
- 最终 blocking issues：4 个；`reversal_rhetoric` × 2、`binary_contrast` × 2，位于非 Block 单元 `output.abstract` 与 `output.x.thread[2]`（最终 lint 行 46、51）
- Plagiarism / Protected Transfer：`not_run`；Style Audit 仍有 blocker，管道按顺序未进入终局 Guard，因此 Protected Transfer 与 Reference Overlap 均未评估
- 最终结果：`status=failed`、`decision=null`、`error_code=writing_audit_failed`
- 审阅包：未生成；预定目录仍不存在
- 安全边界：`OCV-09`、`CON-05` 未使用，`OCV-10` 不存在；未发现虚构事实、产品权益或实验外推
- 未访问 X、公众号、网页或 Browser Bridge；未生成图片；未发布；未写 `data/writing-packs/**`、`data/writing-runs/**` 或 `reports/writing/**`

本次验证表明“同类全部报告”修复已经生效，但当前 Repair 契约只允许修改 Content Blocks，不能修改 `abstract` 或 X item。按本次授权，失败后没有再次运行，也没有修改 Prompt、代码或稿件冒充成功。写作状态继续保持 `implemented_pending_live_validation`，尚不满足 Provisional Profile 写作效果人工审核条件。

## Public-surface audit and repair hardening

第二次真实 dry-run 的根因是 Audit Scope 大于 Repair Scope：Style Audit 检查了标题、摘要、Blocks、CTA 与 X，但旧 Repair 只能修改 Content Blocks；`output.abstract` 和 `output.x.thread[2]` 即使被准确定位，也无法成为合法 Target。本轮只做离线结构修正，没有调用真实 Codex。

Writer 现在把全部公开文本建模为八类 `PublicContentUnit`。主标题、两个备用标题、摘要、CTA 与每条 X 都具有独立、稳定的 `unit_id` 和完整 Evidence / Experiment / Product / Persona / Style 元数据；Blocks 通过 `wechat.block.<block_id>` Adapter 进入同一生命周期。最终渲染仍只输出文本，不暴露 Unit ID。

五类确定性 Audit 改为逐 Unit 运行。human-writing 与 no-ai-slop 的 Raw Issues 都保留 Skill 来源与 commit；同一文本范围的跨 Skill 命中先形成 `RepairIssueGroup`，再按 Unit 合成一个 Repair Target，因此第二次失败形状中的 4 条 Raw Issues 正好生成 `wechat.abstract` 与 `x.thread.2` 两个 targets。

Repair Contract 改为 `repaired_units`：每个 Patch 绑定当前 Unit 的 `original_sha256`，只能修改该 Target 的 `allowed_fields`，并复验 Claim、Experiment、Product、Persona 与 Style allowlist。Unit ID/surface、未命中 Unit、X format/thread 条数、标题数量、article type、block type 和 Unit 集合均不可更改。结构、格式、未知 Claim、关闭 Style Rule等 `non_repairable_contract` 问题直接 `writing_output_invalid`，不再被随意映射到 CTA 或第一 Block。

Plagiarism Audit 现在明确区分 `not_run`、`pass`、`blocked`。Guard 未执行时 `protected_transfer_detected` 与 `reference_overlap_detected` 均为 `null`，报告只能写“未评估”；`READY_FOR_HUMAN_REVIEW` 必须要求实际 Guard `pass`。

离线回归已复现第二次真实失败：摘要与第三条 X 各一处 reversal，Raw Issues 为 `reversal_rhetoric × 2 + binary_contrast × 2`，Repair Targets 为 2；一次 Fixture Repair 同时修复两处，最终 Style Audit `pass`、Plagiarism Guard 实际运行并 `pass`，Writing Pack 达到 `READY_FOR_HUMAN_REVIEW`。完整回归为 68 个测试文件、997 项测试，18 份生成式 Schema 无漂移。

本轮未调用真实 Codex，未访问 X、公众号、网页或 Browser Bridge，未生成图片、未发布、未写正式 Writing 数据，也未修改 Runtime、LaunchAgent、Provisional 审批链或校准 Corpus。工程离线门槛已经满足再次验证条件，但任何真实 Synthetic READY dry-run 仍需要新的明确授权。

## Repair completion and Reviewer blocker preservation

Unit Repair 的受信任边界现在要求 `repaired_units` 与 RepairPlan targets 的 `unit_id` 集合完全一致；漏 Target、额外 Target、重复 Target 均返回 `writing_output_invalid`。每个 Target 的 allowed fields 至少一项必须发生真实变化，否则以 `repair_target_unchanged:<unit_id>` 拒绝；缺失项以 `repair_target_missing:<unit_id>` 定位。

Reviewer 的 hard blocker / blocking style issue 不再在 Repair 后被静默过滤。Pipeline 在调用 Repair 前验证 Reviewer `unit_id` 能解析到真实 Unit、surface 一致、quoted text 非空且不超过 240 字符，并确认它是 Repair 前 Unit 的精确子串；伪引用或空引用直接 `writing_output_invalid`，不进入 Repair 或 Guard。

Repair 后只有在对应 Unit 属于 Target、Repair 完整返回、Unit 真实变化、原 quoted text 已消失且全部确定性 Audit 通过时，Reviewer blocker 才能 discharge。原 quote 残留时继续保留为 final quality issue，返回 `writing_audit_failed`；Plagiarism 保持 `not_run / null / null`，Guard 不执行。

离线回归覆盖漏 Target、部分返回、原样返回、只改其他文字、空 quote、伪 quote 与精确移除成功路径。原摘要 + `x.thread.2` 回归仍由一次 Repair 完整修改两个 Targets，最终 Style/Plagiarism `pass`、`READY_FOR_HUMAN_REVIEW`、model calls=3。完整测试为 68 files / 1005 tests。本轮没有调用真实 Codex、平台、图片或发布能力。

## Third Synthetic READY audit hardening

第三次真实 Synthetic READY Writing 在 Head `c8aed879c30c181c3970a45b2eabc79e805af0b8` 上只执行 1 次，Writer、Reviewer、Repair 共 3 次真实调用。原始结果保持 `status=failed`、`decision=null`、`error_code=writing_audit_failed`。Repair 后 Evidence、Experiment、Product 与 Style 已 pass，但 final quality issues 仍保留 `factual_unit_without_claim × 16`、`required_disclosure_missing × 3`、`reversal_rhetoric × 6`；这 25 条的 code/Unit/surface 与 Reviewer blockers 完全对应，不是 post-repair 确定性 Audit 的现存问题。

Pipeline 现在在 Reviewer 前保存 Evidence、Experiment、Product、First-person、Style 与 Structural 的确定性 blockers，并以 `issue_code + unit_id + surface` 建立稳定 Key。Reviewer echo 只有在对应 Unit 属于 Repair Target、Repair 完整返回、allowed field 真实变化且 Repair 后相同确定性 Key 消失时 discharge；metadata-only 修复不要求正文变化，`required_disclosure_missing` 插入后 quote 应当存在，Style echo 以 Repair 后 Style Audit 为准。Reviewer-only 问题仍要求 exact quote 局部消失。每条 Reviewer Issue 独立判断，无关 blocker 不会让已解决 echo 复活；Guard 仍只在 post-repair deterministic blockers 和 unresolved Reviewer blockers 都为 0 后运行。

`RepairTarget.issue_details` 逐条保存 `issue_code`、severity、`rule_origin`、`source_commit`、`quoted_text` 与 `repair_constraint`。同 Unit 仍只有一个 Target，但同 code 的多个不同 quote 和 human-writing/no-ai-slop 的跨 Skill origin 全部保留；只去重完全相同的 code/origin/quote/constraint。Repair Prompt 明确允许 metadata-only 修复，要求插入缺失 disclosure，并只对 Reviewer-only text issue 局部改写 exact quote；allowed fields、一次 Repair、无新事实和禁止全文重写边界不变。

First-person Audit 不再用任意 `includes('我')` 直接判定单数第一人称。中性教程引导“我们先提取字段，再逐项验收”跳过；“我们实测”仍要求 persona/project evidence；“我们认为”仍要求 `is_opinion=true`；`我(?!们)` 的事实、批准观点形式与其他 fail-closed 边界保持。对第三次保存稿的只读分类结果为：中性“我们” 0、集体事实 0、集体观点 0、独立“我” 19。

在没有执行 Codex、没有初始化 `CodexCliWritingProvider` 的条件下，使用三份保存的 Writer/Reviewer/Repair result 做了一次 `/tmp` 零模型离线重放。25 条 Reviewer echo 已清零，Evidence/Experiment/Product/Style 均为 `pass`；19 条独立“我”仍触发 `unmarked_first_person_opinion`，所以 replay 仍是 `status=failed`、`decision=null`、`writing_audit_failed`。First-person 未清零，Plagiarism 保持 `not_run / null / null`，Guard 未执行；该 replay 不能冒充原 live success，也不能进入人工写作效果审核。

完整离线验证为 69 个测试文件、1020 项测试，Writing Skill 为 2 Skills / 14 files / 23 audited rules，JSON Schema 为 18 files。正式 Research Fixture 仍返回 `BLOCKED_BY_RESEARCH / model.calls=0`；Synthetic READY Fixture 仍以最多 3 次 Provider call 完成一次 Repair、实际运行 Guard 并达到 `READY_FOR_HUMAN_REVIEW`。本轮真实 Writing 次数与真实 Codex Writing 调用均为 0，未访问平台、未生成图片、未发布、未写正式 Writing 数据。
