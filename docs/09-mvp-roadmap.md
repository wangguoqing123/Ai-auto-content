---
title: MVP 实施路线
version: 0.4.0
updated_at: 2026-08-14
status: approved
---

# MVP 实施路线

## 原则

项目按每日闭环逐步增加能力，而不是先批量生成内容再补自动化。

> 系统每天运行，但不要求每天发布。没有足够高质量题目时，自主选题阶段可以输出 `NO_PUBLISH`。

## 阶段 0：账号、人物、产品和真实性规则

交付物：

- 账号定位和目标用户。
- 人物事实与观点库。
- 产品知识库。
- 内容质量、真实性与合规规则。
- 平台内容标准和基础数据结构。

验收：不编造第一人称，不自动补全产品权益，事实和观点可追溯。

状态：基础账号、人物与真实性规则已完成。

## 阶段 0.1：产品真相层 v2

交付物：

- `config/product.yaml` 唯一机器可读产品事实源。
- `config/content-fit.yaml` 学习阶段、内容 pillar、模块映射与 CTA 策略。
- 固定交付状态、产品适配分上限和产品 claim 白名单。
- Zod、Draft 2020-12 JSON Schema、Claim API 和 `product:check`。

状态：`production`。

选题器只能读取 `config/product.yaml` 和 `config/content-fit.yaml`，不得从 Prompt 中自行补全产品权益。产品交付状态会直接限制产品适配分和 CTA。只有 PR #4 合并后才开始每日自主选题器。

## 阶段 1：每日素材采集器

交付物：

- GitHub Actions 每日和手动调度。
- 可配置 RSS / Atom 来源。
- 标准化、URL 规范化、双指纹跨天去重。
- 来源可信度、新鲜度和用户相关度确定性评分。
- JSONL 素材、运行日志、去重状态和 Markdown 日报。
- 单源失败隔离、全源失败语义和离线测试。

验收：同日重跑与跨日运行均不重复；没有合格素材时日报明确说明，不虚构推荐项。

状态：`Cloud Collector` 已为 `production_scheduled`。

## 阶段 1.5：本机 Browser Collector 无人值守运行

交付物：

- 用户 Mac 上的独立 Runtime clone，只跟踪 `main`。
- `RunAtLoad + StartInterval=900` 的 LaunchAgent 到期检查。
- 上海时区 07:30—12:00 的 morning 窗口，目标时间 08:00，每天最多 2 次尝试。
- 上海时区 13:00—18:00 的 topic_selection 窗口，使用本机登录的 Codex CLI，每天最多 2 次尝试。
- 上海时区 13:30—21:00 的 research_pack 窗口，只抓 Topic 指定的官方 fact_source，并使用同一 Codex CLI 完成研究与合成文本实验，每天最多 2 次尝试。
- X 和微信公众号采集、外部状态、原子锁、本机日志与安全通知。
- 只允许 Browser 数据目录进入自动 commit，并在 push 失败时保留本地数据 commit。

状态：X Collector 与 WeChat Collector 均为 `verified_live`，本机生产运行已产生可审计数据；Codex Browser 仍为 `exploration_only`。每日选题调度代码已接入，但 PR 阶段不修改 Runtime clone 或 reload LaunchAgent。

## 阶段 2：每日自主选题器

每日自主选题或 `NO_PUBLISH` 已实现。

输入阶段 1 的合格素材、历史内容和真实用户问题，每天自主决定：

- 产生一个或少量候选题。
- 因证据、价值、重复度或用户相关度不足输出 `NO_PUBLISH`。

本阶段已处理基础 opportunity cluster、历史选题相似度、六维评分、产品/CTA/Claim 校验和严格失败语义，并读取阶段 0.1 的产品契约。本阶段不批量生成 20 个题让人挑选 5 个。

状态：`production`。生产 Provider 为本机 `codex_cli`，当天正式 Topic Decision 已进入 main；GitHub Actions 只运行离线 Fixture。

## 当前系统状态

| 阶段 | 状态 |
|---|---|
| 采集 | `production` |
| 产品真相层 | `production` |
| 每日选题 | `production` |
| 研究与实验 | `implemented_pending_live_validation` |
| 写作 | `not_started` |
| 配图 | `not_started` |
| 发布 | `not_started` |

## 阶段 3：研究、证据核验与安全实验

- 为正式 `SELECT_TOPIC` 建立 Research Pack 和精确短引用证据链。
- 只抓原 Topic 指定的 fact_source canonical URL，并执行 SSRF、类型、大小、超时和版权边界。
- 使用三个合成 text_to_text 任务之一，让 baseline 与 structured 各运行一次。
- 由代码计算验收项，只输出 `READY_FOR_WRITING`、`RESEARCH_INCOMPLETE` 或 `NO_TOPIC`。
- 状态：`implemented_pending_live_validation`。

研究之后的写作仍为 `not_started`：本阶段不生成平台无关母稿、公众号/X 正文、标题、配图或发布包。

## 阶段 4：配图与发布包

- 优先使用真实截图、流程图、对比图和模板渲染。
- 生成封面、步骤图、来源清单和人工检查清单。
- 人负责最终上传或点击发布。
- 不默认无人值守自动发布。

## 阶段 5：平台数据获取与内容复盘

- 在平台允许的方式下获取发布数据。
- 区分曝光、收藏、关注、合格咨询和付费结果。
- 按用户问题、栏目、标题、封面和 CTA 复盘。
- 不混用不同平台的数据口径。

## 阶段 6：策略记忆与每日自主循环

- 把内容表现和人工修改转成可追溯策略记忆。
- 调整来源、评分权重、栏目和内容形式。
- 第二天自动读取最新记忆并开始新一轮。
- 保留事实与产品知识库的人工确认边界。

## 已废止路线

以下不再作为 MVP 实施顺序：

- 一次性生成 20 个候选选题。
- 人工挑选 5 个选题后批量生产。
- 先批量写完内容，再考虑每日自动化和反馈闭环。

新的顺序是：

```text
事实与规则 + 产品真相层 v2
→ 每日素材感知
→ 每日自主选题或 NO_PUBLISH
→ 研究和内容生产
→ 发布包与人工发布
→ 数据复盘
→ 策略记忆
→ 下一天循环
```
