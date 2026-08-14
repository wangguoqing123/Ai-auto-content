---
title: 数据模型
version: 0.2.0
updated_at: 2026-08-13
status: proposed
---

# 数据模型

## 1. 设计目标

数据模型必须回答四个问题：

1. 这条内容解决谁的什么问题？
2. 每个事实从哪里来？
3. 这句话是否代表七天假的真实经历或观点？
4. 发布后是否带来了目标用户和产品结果？

## 2. 素材库 `materials`

云端 RSS 和浏览器来源共享以下核心素材字段：

- `source_platform`、`source_kind`、`collector`、`query_id`、`query_text`、`search_rank`、`source_item_id`、`identity_aliases`
- `source_access_status`：`resolved` 或 `unresolved`
- `author_name`、`author_followers`
- `title`、`excerpt`、`source_url`、`canonical_url`、`content_path`、`content_downloaded`
- `published_at`、`published_at_quality`
- `engagement`；缺失值必须为 `null`
- `metric_quality`、`usage_mode`、`viral_confidence`
- `status`：`accepted`、`rejected` 或 `quarantined`

阶段 1 的 RSS 每日记录继续采用 `data/materials/YYYY-MM-DD.jsonl`，并保留以下确定性评分与指纹字段：

- `material_id`
- `source_id`、`source_name`、`source_type`、`source_tier`
- `category`、`language`、`target_users`、`tags`
- `title`、`source_url`、`canonical_url`、`author`
- `published_at`、`collected_at`
- `excerpt`，只保留有界摘要，不保存第三方全文
- `relevance_score`、`freshness_score`、`evidence_score`、`overall_score`
- `fingerprint`、`content_fingerprint`
- `status`、`rejection_reasons`

Browser 素材的 `material_id` 优先使用平台稳定 `source_item_id`，没有稳定 item ID 时才使用 `canonical_url`。同一素材命中多个查询时，当前字符串字段以去重、稳定排序后的 `query_id` 逗号列表和 `query_text` 中文分号列表保存；临时访问 token 不进入统一素材。

当前 Browser 运行平台只有 `twitter` 和 `weixin`。`sourcePlatformSchema` 中的 `xiaohongshu` 标记为 `deprecated_history_only`，只用于解析历史记录；它不得进入查询配置、Collector Registry、当前日报或发布包。

公众号搜索素材在 discovery 阶段生成主 `source_item_id`，后续 URL 解析和正文下载不得替换它；解析出的 `slug/sn/message/metadata/url` 等更强身份只追加到 `identity_aliases`。发布时间无论是 `exact`、`inferred` 还是 `unknown` 都不参与 discovery identity，主身份只使用经过 NFKC、空白合并、trim、lowercase 和长度限制的标题与摘要。相对时间升级为精确时间时，`material_id` 保持不变；精确发布时间仍作为 `published_at` 与 `published_at_quality` 元数据保存。

公众号 canonical URL 只有满足以下任一条件才可追溯：`/s/<stable-slug>`、包含 `sn`，或同时包含 `__biz + mid + idx`。只有 `signature`、`src`、`scene` 等临时参数，或清理后只剩 `https://mp.weixin.qq.com/s`，都不能升级为 resolved。即使正文下载成功，这类素材也保持 `content_downloaded: true`、`source_access_status: unresolved`、`status: quarantined`，并包含 `unresolved_source_url`；其 Markdown 不保留临时访问 URL。

正式公众号正文以稳定 `material_id` 作为下载目录；同一素材重复运行目录不变，同一天标题相同但身份不同的文章仍写入不同目录，不会覆盖。`content_path` 必须是从仓库根开始的相对 POSIX 路径，例如 `data/weixin-articles/2026-08-14/<material_id>/foo.md`。绝对路径、home 简写、Windows 绝对路径、父目录跳转、符号链接逃逸和非 Markdown 文件均被拒绝。dry-run 的 `content_path` 固定为 `null`，但成功下载仍记录 `content_downloaded: true`。Browser Materials、Run Log 与命令摘要不持久化 Runtime clone 的本机绝对路径。

机器可读契约由 Zod 模型生成并提交：

- `schemas/unified-material.schema.json` 对应 `unifiedMaterialSchema`，用于 Browser 和跨来源核心素材。
- `schemas/material-card.schema.json` 对应 `materialSchema`，用于带 Cloud 评分、信源和指纹字段的完整素材。

两份 JSON Schema 均使用 Draft 2020-12、`additionalProperties: false`，并要求序列化输出包含 `identity_aliases`、`source_access_status` 和 `content_downloaded`。旧 Cloud JSON 行先经过 `materialSchema.parse`，由 Zod 补成 `[]`、`resolved` 和 `false` 后再持久化。`npm run schema:check` 会在临时目录重新生成并比对提交文件，防止运行时模型与契约再次漂移。

本机调度状态不进入 Git，固定保存在 `~/Library/Application Support/AiAutoContent/state/scheduler-state.json`。`success` 与 `partial_success` 都表示当天 morning 已完成；`failed` 可在窗口内按配置重试，`git_sync_failed` 保留已采集数据和本地 commit。下一次先校验并恢复 pending commit；仅当恢复日期包含当天时才根据状态跳过当天采集，只恢复历史日期则继续当前日期任务。

`accepted` 不等于“只有标题和摘要即可使用”。只有搜狗标题和摘要、尚无可追溯 `mp.weixin.qq.com` 原文 URL 的候选必须满足：

- `source_access_status: unresolved`
- `status: quarantined`
- `rejection_reasons` 包含 `unresolved_source_url`
- `usage_mode: structure_inspiration`
- `viral_confidence: unverified`

解析出可追溯微信原文 URL 后，素材升级为 `source_access_status: resolved`；即使正文下载失败，也可保留可追溯的搜索素材，并保持 `content_downloaded: false`。

旧版规划字段在后续语义整理阶段按需映射：

核心字段：

- `material_id`
- `source_type`
- `source_url`
- `source_title`
- `source_author`
- `published_at`
- `captured_at`
- `raw_text`
- `summary`
- `user_problem`
- `target_segment`
- `credibility_level`
- `freshness_status`
- `copyright_status`
- `privacy_status`
- `duplicate_group_id`
- `evidence_ids`
- `status`

## 3. 证据库 `evidence`

核心字段：

- `evidence_id`
- `claim`
- `evidence_type`
- `source_id`
- `source_excerpt`
- `screenshot_path`
- `verified_at`
- `verified_by`
- `confidence`
- `valid_until`
- `public_use_allowed`
- `notes`

## 4. 用户问题库 `user_problems`

核心字段：

- `problem_id`
- `problem_text`
- `segment`
- `scenario`
- `desired_result`
- `frequency_score`
- `emotion_score`
- `cost_score`
- `commercial_intent_score`
- `source_count`
- `sample_source_ids`
- `last_seen_at`

## 5. 选题库 `topics`

当前 v0 不建立数据库或长选题库，而是按天保存一个严格决定：

- `data/topic-decisions/YYYY-MM-DD.json`：当日正式决定。
- `data/topic-runs/topic_<timestamp>.json`：每次运行的不可覆盖审计记录。
- `reports/topics/YYYY-MM-DD.md`：只突出一个母题或 NO_PUBLISH。

`topicDecisionSchema` 要求 `SELECT_TOPIC` 只有一个 `selected_topic`，`NO_PUBLISH` 没有 selected topic 且有内容原因，failed 的 `decision` 必须为 null。`evaluated_candidates` 最多 3 个。`topic_signature` 由 learner stage、用户问题、真实任务、最小结果和 core angle 规范化后由代码生成 SHA-256。

Material Card 只有安全、受限字段；restricted 公众号 canonical URL 为 null、摘要最多 300 字，不携带 `content_path` 或正文。input hash 记录材料 ID、角色、互动、历史签名、配置哈希、Provider、模型和 Prompt 版本。

核心字段：

- `topic_id`
- `title_working`
- `target_segment`
- `user_problem_id`
- `core_conclusion`
- `content_pillar`
- `original_value`
- `experiment_required`
- `product_connection`
- `pain_score`
- `actionability_score`
- `result_visibility_score`
- `evidence_score`
- `shareability_score`
- `product_fit_score`
- `total_score`
- `hard_blockers`
- `status`

## 6. 实验库 `experiments`

v0 不建立数据库，实验作为当天 Research Pack 的受限子产物保存：

- `data/research-packs/YYYY-MM-DD/research-pack.json`：唯一正式研究决定与写作门槛。
- `source-manifests/*.json`：来源身份、URL、SHA-256、状态与最多 500 字符的短引用；单来源合计最多 1,500 字符。
- `experiments/experiment-spec.json`：同模型、同输入 hash、相同超时与两个 Variant prompt hash。
- `experiments/baseline_chat_request.json` 与 `structured_task_card.json`：合成 text_to_text 输出、代码验收、耗时与 usage。
- `data/research-runs/research_<timestamp>.json`：每次安全审计记录。
- `reports/research/YYYY-MM-DD.md`：不包含正文的可读报告。

`researchPackSchema` 区分 `status=success|failed` 与业务 `decision=READY_FOR_WRITING|RESEARCH_INCOMPLETE|NO_TOPIC|null`。基础设施失败必须 `decision=null`；`NO_TOPIC` 不得有来源、模型调用或实验。Topic 快照固定保存 signature、run ID、工作标题、stage、pillar、主模块和 CTA，研究层不能换题。

完整清洗来源段落不属于 Git 数据模型，只在 `~/Library/Application Support/AiAutoContent/research-cache/` 以 0700/0600 权限短期保存。Git Schema 不含 `segments`、HTML、完整正文、原始事件流或思维链。

## 6.1 当前实验字段

核心字段：

- `experiment_id`
- `topic_id`
- `hypothesis`
- `task`
- `input_assets`
- `model`
- `prompt_version`
- `steps`
- `output_assets`
- `started_at`
- `finished_at`
- `cost`
- `duration`
- `result`
- `failure_points`
- `screenshots`
- `reproducible`
- `reviewed_by_human`

## 7. 内容库 `contents`

核心字段：

- `content_id`
- `topic_id`
- `research_pack_id`
- `master_draft`
- `platform`
- `platform_version`
- `title`
- `body`
- `visual_assets`
- `cta`
- `source_ids`
- `persona_claim_ids`
- `product_claim_ids`
- `quality_score`
- `blockers`
- `status`

## 8. 人物事实库 `persona_facts`

核心字段：

- `fact_id`
- `statement`
- `tag`
- `evidence_ids`
- `allowed_first_person`
- `public_use_allowed`
- `valid_from`
- `valid_until`
- `notes`

## 9. 产品权益库 `product_claims`

核心字段：

- `claim_id`
- `claim_text`
- `status`
- `evidence_ids`
- `valid_from`
- `valid_until`
- `allowed_in_sales_copy`
- `notes`

## 10. 发布记录 `publications`

核心字段：

- `publication_id`
- `content_id`
- `platform`
- `account`
- `published_at`
- `url`
- `title_version`
- `cover_version`
- `cta_version`
- `policy_check_date`
- `manual_reviewer`

## 11. 数据复盘 `performance`

核心字段：

- `publication_id`
- `snapshot_at`
- `impressions`
- `views`
- `read_completion`
- `likes`
- `saves`
- `comments`
- `shares`
- `follows`
- `direct_messages`
- `lead_magnet_claims`
- `qualified_leads`
- `club_sales`
- `revenue`
- `notes`

## 12. 关键计算指标

- 收藏率 = 收藏 / 有效阅读或曝光。
- 关注转化率 = 新增关注 / 有效阅读或曝光。
- 合格咨询率 = 合格咨询 / 1000 次有效曝光。
- 付费转化率 = 俱乐部付费 / 合格咨询。
- 母题效率 = 多平台有效结果 / 母题总生产成本。

不同平台数据口径不一致，计算前必须记录分母定义，不能混为一谈。
