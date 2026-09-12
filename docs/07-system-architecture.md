---
title: 系统架构
version: 0.4.0
updated_at: 2026-08-15
status: style_intelligence_implemented_pending_real_corpus
---

# 系统架构

## Writing Pack v0 补充

```text
Research Pack
  → Research Gate（最先执行）
  → Style Approval Chain Resolver（Receipt v2 或 Legacy + Binding）
  → 不可伪造 Resolved Writing Style
  → WeChat / X Style Recipe
  → Writer（结构化 Blocks）
  → 代码 Evidence / Experiment / Product / First-person Audit
  → human-writing Lint + no-ai-slop detect-only + Quality Reviewer
  → 最多一次局部 Repair
  → 本地 Plagiarism / Protected Transfer Guard
  → READY_FOR_HUMAN_REVIEW
```

Research Gate 前不得读取 Style 文件、模型环境或初始化 Provider。Writer 与 Reviewer 都看不到原始 Style 文件、Reference Corpus 和 Protected Entry；Guard 只在模型调用完成后只读加载这些本机材料。Scheduler 的 Writing 窗口为 14:30—22:00，只接受 approved Style，PR 阶段不安装或 reload。

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

阶段 2 现已实现：

```text
Cloud / Browser 已有素材
→ 72 小时硬过滤与五种来源角色
→ 确定性去重、聚类、排序和多样性预算
→ 不可信 Material Cards + 压缩 Product Context
→ 本机 Codex CLI Provider 最多两次结构化输出调用
→ 最多 3 个候选
→ 代码执行硬淘汰、六维重算、产品上限、CTA、Claim 和 30 天去重
→ 1 个 SELECT_TOPIC 或 NO_PUBLISH
```

模型网络或结构失败为 `status=failed`，不输出 `NO_PUBLISH`。相同日期和 `input_hash` 的成功决定直接返回 `ALREADY_DECIDED`。完整契约见 `docs/21-daily-topic-intelligence.md`。

阶段 3 的研究与安全实验 v0 已实现：

```text
Topic Decision
→ 只读取 selected_topic.fact_source_ids
→ 公共 URL / DNS / 每次重定向 SSRF 检查
→ 本机 0700/0600 清洗段落缓存
→ Codex 只读结构化研究，代码精确验证 quote 子串
→ 必要时 baseline 与 structured 各一次 text_to_text 实验
→ 代码计算 8 项验收
→ READY_FOR_WRITING / RESEARCH_INCOMPLETE / NO_TOPIC
```

网络、Codex、文件或 Schema 故障保持 `status=failed`、`decision=null`。Research Pack 只提交短引用，不提交第三方完整网页；完整契约见 `docs/22-research-and-experiment-packs.md`。

真实选题和研究不在 GitHub Actions 调用模型。Mac Local Runtime 复用 `RunAtLoad + StartInterval=900` 的 LaunchAgent：Morning 在 07:30—12:00，Topic Selection 在 13:00—18:00，Research Pack 在 13:30—21:00。Topic 与 Research 共用结构化 Codex Runner；最终校验、写盘和 Git 白名单提交仍由项目代码执行。

写作前的风格智能 v0 已实现：

```text
本机 0700/0600 私有语料
→ TypeScript 确定性节奏指标
→ Fixture 或最多 Distill + Repair 两次只读 Codex 调用
→ Style Profile（三类结果分开）
→ 权重受限、可复现的 Style Recipe
→ human-writing 正向规则
→ 初稿后 revision + no-ai-slop detect-only
→ 确定性 Lint + 仅本机语料防抄袭
→ 人工修改反馈提案
```

真实语料不进入 Git，CI 只运行合成 Fixture。没有 owner Profile 时使用 editorial voice 与 human-writing baseline，不声称系统已经学会七天假的风格。完整契约见 `docs/23-style-intelligence-and-writing-skills.md`。

## 2. 架构原则

- 固定、可测试的流程优先于大量 Agent 自主讨论。
- 每一步都有清晰输入、输出、状态和失败语义。
- 事实和证据链贯穿全流程。
- 确定性处理优先；只有后续需要语义判断时才考虑模型。
- 单个外部来源失败不拖垮整次运行，所有来源失败则明确失败。
- 文件输出保持可审计、可 Git Diff、可跨天恢复。
- 人只保留少量高价值判断，不承担重复劳动。
- 产品事实与策略假设分层；未来 Agent 不能从 Prompt 或海报方向补全权益。

## 3. 产品真相与内容承接层

每日选题器之前增加一个完全离线、确定性的产品底盘：

```text
config/product.yaml                   config/content-fit.yaml
产品事实、交付状态、价格、claims       学习阶段、pillar、适配上限、CTA
          │                                      │
          └──────── Zod + JSON Schema ───────────┘
                              │
                     npm run product:check
                              │
           模块引用、claim 唯一性、比例与上限校验
                              │
                    PR #5 每日自主选题器
```

`config/product.yaml` 是唯一机器可读产品事实源；`config/content-fit.yaml` 明确标记为 `strategy_hypothesis`。产品价格每次从产品配置读取，未知 claim 和模块默认拒绝，交付状态直接限制产品适配分与 CTA。

## 4. 当前采集实现：阶段 1 与 1.5

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

### 4.1 调度层

- GitHub Actions 在 UTC 01:00，即北京时间 09:00 启动。
- 同时支持 `workflow_dispatch` 手动运行。
- 执行依赖安装、类型检查、离线测试和真实采集。
- 只在指定输出目录有变化时提交，工作流不监听 `push`，不会因机器人提交自触发。

### 4.2 采集层

- Cloud Collector 当前注册 `rss` 与 `aihot`：RSS 同时解析 RSS/Atom，AIHOT 只调用稳定 `/api/v1/items`。
- 并发上限、超时、重试次数和 User-Agent 由配置控制。
- 每个来源单独记录开始、结束、抓取、新增、重复、淘汰和错误。
- 只保留标题、链接、作者、发布时间和最多 500 字摘要，不保存第三方全文。

### 4.3 处理层

- URL 规范化删除 fragment 和追踪参数，保留影响内容的查询参数。
- URL 指纹为 canonical URL 的 SHA-256。
- 内容指纹为标准化标题与摘要的 SHA-256。
- `data/state/seen-materials.json` 保存两类指纹，实现同日幂等和跨天去重。
- 评分完全由 `config/scoring.yaml` 的关键词、来源等级、时间分段、权重和阈值决定。

### 4.4 存储与报告层

- 只把最近 7 天内的正常素材和发布时间未知的隔离素材追加到 JSONL；更旧内容只更新指纹状态。
- 达标素材标记为 `accepted`，未达标素材标记为 `rejected` 并保留规则原因。
- 日报的推荐项只来自 `accepted`，没有合格项时明确显示无高质量新素材。
- 所有来源失败时仍记录失败日志和日报，然后让任务返回失败状态。

### 4.5 浏览器采集 MVP

- `Cloud Collector` 继续运行 RSS、AIHOT 和公开无登录来源。
- `Browser Collector` 通过 `child_process.spawn('opencli', args)` 调用 X 和公众号只读命令，查询词不经过 shell 拼接。
- 运行前必须通过 `opencli doctor`；登录失效、验证码和风险控制都会停止该平台。
- macOS 本机调度器只在上海时区早晨窗口内运行一次，状态和锁保存在 Runtime clone 外部。
- GitHub-hosted Workflow 永远不调用 `collect:browser`。
- 详细运行边界见 `docs/15-hybrid-collector-runtime.md`，真实能力状态见 `docs/14-opencli-live-capability-spike.md`。

## 5. 后续模块边界

采集、产品真相、每日选题和研究已经进入 production。风格智能为 `implemented_pending_real_corpus`。PR #8 才消费 Research Pack、Style Recipe 和写作 Skill 生成正文；后续再增加配图与发布包、平台数据回收和策略记忆。它们必须读取产品真相层，不能反向污染人物事实、产品交付状态和真实性规则。

当前不实现：

- 正式正文、X 内容和多平台文案。
- 图片生成、自动登录和自动发布。
- 已发布内容的效果复盘和策略学习。
- 数据库、管理后台、社交平台爬虫和反爬绕过。

## 6. 未来状态机

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

当前风格智能只负责写作规则、Profile、Recipe、审查和反馈提案，不进入 `DRAFTING`，也不生成内容。

## 7. 安全与可追溯性

- 密钥只放 GitHub Secrets 或环境变量，公开仓库不提交密钥和私密用户数据。
- 外部错误只保存有界摘要，避免日志无限增长。
- 所有运行和来源结果都带时间、数量与状态。
- 配置和输出通过 Zod 校验，损坏的去重状态不会被静默忽略。
- 产品与内容承接配置使用 Draft 2020-12 JSON Schema，并由 `product:check` fail closed。
- 写作 Skill 文件由 commit 与 SHA-256 固定；Style Profile/Recipe 使用 Draft 2020-12 JSON Schema，私有语料只保存在本机。
- 自动提交只包含素材、运行日志、状态和日报目录。
