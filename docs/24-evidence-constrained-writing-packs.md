---
title: 基于证据、已批准风格规则与 Human Send Gate 的写作包
version: 1.0.0
updated_at: 2026-08-18
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
