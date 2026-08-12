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

阶段 1 的每日采集记录采用 `data/materials/YYYY-MM-DD.jsonl`，每行一个通过 Zod 校验的对象。当前字段：

- `material_id`
- `source_id`、`source_name`、`source_type`、`source_tier`
- `category`、`language`、`target_users`、`tags`
- `title`、`source_url`、`canonical_url`、`author`
- `published_at`、`collected_at`
- `excerpt`，只保留有界摘要，不保存第三方全文
- `relevance_score`、`freshness_score`、`evidence_score`、`overall_score`
- `fingerprint`、`content_fingerprint`
- `status`、`rejection_reasons`

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
