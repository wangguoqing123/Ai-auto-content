---
title: 系统架构
version: 0.2.0
updated_at: 2026-08-12
status: implemented_stage_1_5
---

# 系统架构

## 1. 架构目标

系统不是批量内容工厂，而是一条每天重新感知、判断和学习的闭环：

```text
每日启动
→ 收集和分析新素材
→ 判断当天是否存在值得做的选题
→ 研究、写作和生成发布包
→ 人工最终上传或点击发布
→ 获取发布数据并复盘
→ 更新下一轮策略
→ 第二天继续
```

每天运行不等于每天发布。阶段 2 的自主选题器必须支持 `NO_PUBLISH`。

## 2. 架构原则

- 固定、可测试的流程优先于大量 Agent 自主讨论。
- 每一步都有清晰输入、输出、状态和失败语义。
- 事实和证据链贯穿全流程。
- 确定性处理优先；只有后续需要语义判断时才考虑模型。
- 单个外部来源失败不拖垮整次运行，所有来源失败则明确失败。
- 文件输出保持可审计、可 Git Diff、可跨天恢复。
- 人只保留少量高价值判断，不承担重复劳动。

## 3. 当前实现：阶段 1

第一阶段采用 Node.js 20、TypeScript、npm 和 GitHub Actions；阶段 1.5 增加仅在用户自有机器运行的 OpenCLI Browser Collector，仍不引入数据库、n8n 或大模型 API。

```text
.github/workflows/daily-material-collection.yml
                    │
                    ▼
            config/sources.yaml
                    │
                    ▼
        RSS / Atom Collector Registry
          │  限流、15 秒超时、重试 2 次
          │  单源失败隔离
          ▼
 normalize → canonical URL → fingerprints → deduplicate
                    │
                    ▼
       deterministic scoring + Zod validation
          │               │               │
          ▼               ▼               ▼
 data/materials/   data/state/      data/runs/
          │
          ▼
 reports/materials/YYYY-MM-DD.md
```

### 3.1 调度层

- GitHub Actions 在 UTC 01:00，即北京时间 09:00 启动。
- 同时支持 `workflow_dispatch` 手动运行。
- 执行依赖安装、类型检查、离线测试和真实采集。
- 只在指定输出目录有变化时提交，工作流不监听 `push`，不会因机器人提交自触发。

### 3.2 采集层

- Cloud Collector 当前注册 `rss` 与 `aihot`：RSS 同时解析 RSS/Atom，AIHOT 只调用稳定 `/api/v1/items`。
- 并发上限、超时、重试次数和 User-Agent 由配置控制。
- 每个来源单独记录开始、结束、抓取、新增、重复、淘汰和错误。
- 只保留标题、链接、作者、发布时间和最多 500 字摘要，不保存第三方全文。

### 3.3 处理层

- URL 规范化删除 fragment 和追踪参数，保留影响内容的查询参数。
- URL 指纹为 canonical URL 的 SHA-256。
- 内容指纹为标准化标题与摘要的 SHA-256。
- `data/state/seen-materials.json` 保存两类指纹，实现同日幂等和跨天去重。
- 评分完全由 `config/scoring.yaml` 的关键词、来源等级、时间分段、权重和阈值决定。

### 3.4 存储与报告层

- 只把最近 7 天内的正常素材和发布时间未知的隔离素材追加到 JSONL；更旧内容只更新指纹状态。
- 达标素材标记为 `accepted`，未达标素材标记为 `rejected` 并保留规则原因。
- 日报的推荐项只来自 `accepted`，没有合格项时明确显示无高质量新素材。
- 所有来源失败时仍记录失败日志和日报，然后让任务返回失败状态。

### 3.5 浏览器采集 MVP

- `Cloud Collector` 继续运行 RSS、AIHOT 和公开无登录来源。
- `Browser Collector` 通过 `child_process.spawn('opencli', args)` 调用 X 和公众号只读命令，查询词不经过 shell 拼接。
- 运行前必须通过 `opencli doctor`；登录失效、验证码和风险控制都会停止该平台。
- macOS 本机调度器只在上海时区早晨窗口内运行一次，状态和锁保存在 Runtime clone 外部。
- GitHub-hosted Workflow 永远不调用 `collect:browser`。
- 详细运行边界见 `docs/15-hybrid-collector-runtime.md`，真实能力状态见 `docs/14-opencli-live-capability-spike.md`。

## 4. 后续模块边界

后续阶段依次增加：自主选题器、研究与内容生成、配图与发布包、平台数据回收、策略记忆。它们读取阶段 1 的结构化结果，但不能反向污染已确认的人物事实、产品知识和真实性规则。

当前不实现：

- 自动选题、自动写作和多平台文案。
- 图片生成、自动登录和自动发布。
- 已发布内容的效果复盘和策略学习。
- 数据库、管理后台、社交平台爬虫和反爬绕过。

## 5. 未来状态机

```text
COLLECTED
→ NORMALIZED
→ SCORED
→ CANDIDATE_TOPIC | REJECTED_LOW_VALUE
→ APPROVED_TOPIC | NO_PUBLISH
→ RESEARCHING
→ DRAFTING
→ REVIEWING
→ READY_FOR_HUMAN
→ PUBLISHED
→ REVIEWED_PERFORMANCE
```

阶段 1 只负责到 `SCORED` 或 `REJECTED_LOW_VALUE`，不越界产生选题或内容。

## 6. 安全与可追溯性

- 密钥只放 GitHub Secrets 或环境变量，公开仓库不提交密钥和私密用户数据。
- 外部错误只保存有界摘要，避免日志无限增长。
- 所有运行和来源结果都带时间、数量与状态。
- 配置和输出通过 Zod 校验，损坏的去重状态不会被静默忽略。
- 自动提交只包含素材、运行日志、状态和日报目录。
