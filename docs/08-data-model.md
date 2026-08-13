---
title: 数据模型
version: 0.1.0
updated_at: 2026-08-12
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

公众号搜索素材在 discovery 阶段生成主 `source_item_id`，后续 URL 解析和正文下载不得替换它；解析出的 `slug/sn/message/metadata/url` 等更强身份只追加到 `identity_aliases`。发布时间无论是 `exact`、`inferred` 还是 `unknown` 都不参与 discovery identity，主身份只使用经过 NFKC、空白合并、trim、lowercase 和长度限制的标题与摘要。相对时间升级为精确时间时，`material_id` 保持不变；精确发布时间仍作为 `published_at` 与 `published_at_quality` 元数据保存。

机器可读契约由 Zod 模型生成并提交：

- `schemas/unified-material.schema.json` 对应 `unifiedMaterialSchema`，用于 Browser 和跨来源核心素材。
- `schemas/material-card.schema.json` 对应 `materialSchema`，用于带 Cloud 评分、信源和指纹字段的完整素材。

两份 JSON Schema 均使用 Draft 2020-12、`additionalProperties: false`，并要求序列化输出包含 `identity_aliases`、`source_access_status` 和 `content_downloaded`。旧 Cloud JSON 行先经过 `materialSchema.parse`，由 Zod 补成 `[]`、`resolved` 和 `false` 后再持久化。`npm run schema:check` 会在临时目录重新生成并比对提交文件，防止运行时模型与契约再次漂移。

`accepted` 不等于“只有标题和摘要即可使用”。只有搜狗标题和摘要、尚无可追溯 `mp.weixin.qq.com` 原文 URL 的候选必须满足：

- `source_access_status: unresolved`
- `status: quarantined`
- `rejection_reasons` 包含 `unresolved_source_url`
- `usage_mode: structure_inspiration`
- `viral_confidence: unverified`

解析出合法微信原文 URL 后，素材升级为 `source_access_status: resolved`；即使正文下载失败，也可保留可追溯的搜索素材，并保持 `content_downloaded: false`。

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
