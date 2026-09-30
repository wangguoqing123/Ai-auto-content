---
title: 内容与获客策略
version: 2.0.0
updated_at: 2026-08-14
status: strategy_hypothesis
machine_source: config/content-fit.yaml
---

# 内容与获客策略

## Writing Pack v0 补充

`SELECT_TOPIC` 不能直接生成正文。只有 Research Pack 明确 `READY_FOR_WRITING`，且 Style Approval Chain 合法，才允许生成一篇公众号和一个 X 版本；全部结果进入 Human Send Gate，由人决定是否发送。`RESEARCH_INCOMPLETE` 必须停止在 `BLOCKED_BY_RESEARCH`。

当前 Owner Style 只代表短内容代理语料，不代表原生 X 或公众号长文。公众号结构由 article type、human-writing、WeChat 平台规则与获准 Reference Technique 共同承担；Reference 不提供声音、身份、经历、事实或 preferred terms。

## 1. 内容系统的目标

内容系统不是“每天自动发几篇”，而是自动发现真实问题，完成可靠研究和必要验证，生产能帮助用户、建立信任并自然承接真实产品的内容。

核心用户不再宽泛写成“AI 小白”，而是：

> 已经开始接触 AI，但还没有稳定用起来、没有形成完整方法和工作流的人。

每天运行不等于每天发布。当前选题器在价值、证据或产品承接不足时输出 `NO_PUBLISH`；模型或系统失败使用 `status=failed`，不能冒充内容判断。

每日选题最多评估 3 个候选，只能选 1 个母题。`SELECT_TOPIC` 只进入研究与实验，不生成正文。六维评分固定为痛点 25、可行动性 20、可展示性 15、证据 15、互动潜力 15、产品适配 10，总分由代码重算，80 分只是必要条件，仍需全部硬性校验通过。

## 2. 每篇内容先定位学习阶段

每个候选选题必须标记一个或多个 `learner_stage`：

1. `concept_confusion`：模型、工具、Skill、MCP、Agent 概念混乱。
2. `tool_selection`：收藏很多工具，不知道哪个值得学。
3. `unstable_usage`：会使用 AI，但输出时好时坏。
4. `task_breakdown`：会聊天，但不会完成复杂任务。
5. `workflow_building`：多个工具不会协同，每次从零开始。
6. `project_delivery`：学过知识，却没有完成真实成品。
7. `continuous_improvement`：完成过一次任务，但没有复盘、Skill 和迭代。
8. `business_integration`：希望把 AI 接入内容、工作或真实业务。

## 3. 内容 pillar 与初始比例

比例是 `STRATEGY_HYPOTHESIS`，不是产品事实：

| Pillar | 初始比例 | 当前承接重点 |
|---|---:|---|
| `orientation_and_selection` | 20% | 学习路径、小白基础课、常见问题 |
| `stable_ai_usage` | 20% | 小白基础课、Codex 基础课 |
| `agents_and_workflows` | 15% | Skill、MCP、工作流与 Codex 实操 |
| `content_automation` | 20% | 已交付的账号内容系统课程 |
| `codex_and_productivity` | 15% | Codex 基础、15 个应用场景与已确认提效范围 |
| `projects_cases_and_templates` | 5% | 已确认案例与项目/模板容器，不补数量 |
| `curation_and_community` | 5% | 精选入口和社群交流，不承诺频率 |
| `ai_video_production` | 0% | 当前仅确认方向，等待进一步交付证据 |

AI 视频不是永久为 0；人工确认交付深度后，才能修改状态、适配分上限和比例。

## 4. 产品经理视角是所有内容的 editorial lens

“互联网产品经理视角”不再是孤立的 10% 内容分类。所有内容都应用同一套编辑视角：

1. 先定义问题。
2. 明确任务目标。
3. 建立判断标准。
4. 根据任务选择工具。
5. 设计工作流。
6. 设置验收标准。
7. 复盘和迭代。

## 5. 每个候选选题必须回答的问题

- 用户卡在哪个学习阶段？
- 对应哪个真实产品模块？
- 用户正在完成什么任务？
- 当前错误做法是什么？
- 免费内容交付什么最小结果？
- 结果怎样展示或验证？
- 为什么可能需要系统学习？
- 当前课程是否真实承接，交付状态是什么？

答不清产品模块时，产品适配分为 0，但选题仍可因独立用户价值而存在；不能为了转化虚构承接。

写作阶段不再使用全局固定的 3 到 5 步。`tutorial`、`analysis`、`case_breakdown`、`opinion` 和 `checklist` 各自使用与任务匹配的结构，只有 tutorial 与 checklist 强制步骤或清单。每篇只从 Style Recipe 选择少量相关技巧，不能把多个参考作者的全部特征叠加。

风格只调整表达，不改变 Research Claim、Persona 事实、Product Claim 或平台硬规则。public reference 只能贡献抽象技巧和统计特征，不能迁移身份、观点、经历、口头禅、比喻、事实或客户故事。完整边界见 `docs/23-style-intelligence-and-writing-skills.md`。

## 6. 当前选题优先级

优先：

- AI 基础认知、工具选择与稳定使用。
- AI 内容自动化。
- Codex 与工作提效。
- 智能体、Skill 与工作流。
- 已确认的真实项目与案例。

谨慎：

- AI 视频生产，直到交付目录进一步确认。
- 只有海报方向、没有当前交付证据的模块。
- 容器存在但数量和明细未知的项目、模板和更新内容。

## 7. 产品适配评分

候选题总分仍为 100，产品适配项为 0～10。它必须对应实际模块，并受交付状态限制：

| 交付状态 | 上限 |
|---|---:|
| `confirmed_delivered` | 10 |
| `confirmed_partial` | 7 |
| `confirmed_container` | 5 |
| `direction_confirmed_delivery_unverified` | 3 |
| `unknown` | 0 |

不能因为话题与 AI 有关就得到产品适配分。产品适配分不能覆盖用户价值不足、证据不足或内容重复；海报方向不能自动当成完整交付。

最终上限为所有实际匹配模块交付状态上限与 pillar 上限的最小值。supporting module 不能抬高上限。AI 视频当前最高 3，内容自动化最高 10。

## 8. CTA 承接规则

- `none`：与产品关系弱，只提供独立价值，不强行承接。
- `light`：对应学习路径或可说明的交付方向，只提示“这类问题适合系统学习”，不直接销售、不补全权益。
- `club`：仅对应 `confirmed_delivered` 或 `confirmed_partial` 模块；内容已经完整解决一个具体小问题，俱乐部承接更系统路径、更多实践或社群交流。

`direction_confirmed_delivery_unverified` 不能使用 `club`。任何 CTA 都不能故意省略关键步骤逼迫付费。

代码取所有匹配模块允许 CTA 的交集，非法 `club` 自动降级并记录。Product Claim 必须属于产品配置；evidence-required Claim 的 material / experiment / project / case 引用必须真实存在。选题阶段不输出价格话术，`club` 只标记 `price_refresh_required: true`。

## 9. 素材、研究与证据

素材优先级依次为真实用户问题、真实任务、官方更新和热点信号。涉及“实测、对比、效果、效率、最好用、跑通过、可以复用”时，必须先取得实验或项目证据。

可以记录失败的实验，但不能把失败包装成成功。项目记录应保留输入、输出、成本、耗时、失败点、调整过程和验收结果。

## 10. 热点进入内容的门槛

热点继续必须回答：

> 这件事和正在真实使用 AI、但没有形成稳定方法的人有什么关系？

还要回答它对应哪个学习阶段、什么任务、是否有可验证的小结果。只能重复新闻、没有具体问题或必须严重夸张标题时直接淘汰。

## 11. 免费内容到产品的链路

```text
公众号 / X 内容
        ↓
完整交付一个可执行、可验证的小结果
        ↓
用户识别自己的学习阶段和下一步
        ↓
真实已交付模块、系统路径或社群交流
```

一个母题可以共享研究包和证据，但公众号文章、X Post / Thread 和公众号配图要分别按平台组织。小红书不在当前采集、内容生产、发布或复盘范围。

## 12. 策略更新

- 产品事实变化先更新 `config/product.yaml`。
- 学习阶段、pillar、模块映射、适配上限或 CTA 变化更新 `config/content-fit.yaml`。
- 比例只在 `config/project.yaml` 的 `content_mix` 维护，并必须合计为 1。
- 每次变更运行 `npm run product:check`、`npm run schema:check` 和测试。
- 发布数据只能调整策略假设，不能反向改写产品事实或交付状态。
- 人工改稿至少出现三次同方向变化后，才允许生成 `proposed_profile_delta`；Profile 版本升级仍需用户明确批准。
