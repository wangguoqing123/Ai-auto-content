---
title: 产品真相层与内容承接地图
version: 2.0.0
updated_at: 2026-08-14
status: implemented_pending_review
---

# 产品真相层与内容承接地图

## 1. 为什么必须先校准产品

旧配置把产品压缩成“社群交流 + AI 教程”，把学习路径、任务实践和模板库写成建议升级项，也没有区分海报方向与当前交付。这会让未来选题器把任何 AI 话题都误判为强产品承接，并可能自动生成不存在的权益、数量、频率或销售紧迫感。

PR #4 先建立稳定产品底盘，不实现每日选题器、模型调用、内容生成、配图或发布。

## 2. 产品事实与策略假设

| 层 | 文件 | 性质 | 更新依据 |
|---|---|---|---|
| 产品事实 | `config/product.yaml` | 唯一机器可读产品真相源 | 用户确认、海报、目录截图和后续证据的优先级 |
| 内容承接 | `config/content-fit.yaml` | `strategy_hypothesis` | 学习阶段、模块映射、适配上限和 CTA 策略 |
| 项目比例 | `config/project.yaml` | `strategy_hypothesis` | 当前交付成熟度和后续内容数据 |

事实层不能被策略数据反向覆盖。Prompt 只能读取配置，不能复制一套产品权益常量。

## 3. 海报方向与实际交付

海报可以确认产品方向和标准价格；会员目录截图可以确认当前可见模块、主题和容器。方向不等于完整交付，容器存在也不等于知道数量和明细。

`delivery_status` 只有五种：`confirmed_delivered`、`confirmed_partial`、`confirmed_container`、`direction_confirmed_delivery_unverified` 和 `unknown`。AI 视频当前属于方向已确认、交付未验证，不能使用 `club` CTA。

## 4. 用户学习阶段地图

学习阶段从概念混乱、工具选择、使用不稳定、任务拆解，逐步进入工作流构建、项目交付、持续改进和业务接入。未来每个选题必须标明用户卡点，不能只写“适合 AI 小白”。

```text
概念混乱 → 工具选择 → 使用不稳定 → 任务拆解
                                  ↓
业务接入 ← 持续改进 ← 项目交付 ← 工作流构建
```

## 5. 产品模块地图

共同基础包含 AI 基础认知、稳定使用 AI、智能体与工作流；实战方向包含 AI 内容创作、AI 视频生产、AI 小工具与工作提效。实际承接使用 13 个稳定 module ID，详见 `config/product.yaml` 的 `delivery_catalog`。

重点映射：

- 认知与工具选择 → 会员首页、学习路径、小白基础课、帮助入口。
- 稳定使用 → 小白基础课、Codex 基础课、学习路径。
- 智能体与工作流 → 小白基础主题、Codex 实操。
- 内容自动化 → 已交付的账号内容系统课程。
- Codex 与工作提效 → Codex 基础、15 个应用场景、已确认提效范围。
- AI 视频 → 当前只有方向级承接。
- 项目、案例与模板 → 已确认案例和两个容器。
- 筛选与不掉队 → 会员首页、课程更新与精选入口。

## 6. 当前交付成熟度

`confirmed_delivered`：会员首页、学习路径、小白基础课、AI 内容自动化、Codex 基础课、Codex 15 个场景、常见问题与帮助。

`confirmed_partial`：真实 AI 使用案例库、AI 小工具与工作提效。

`confirmed_container`：完整项目、模板与下载资料、课程更新与不掉队精选。

`direction_confirmed_delivery_unverified`：AI 视频生产。

## 7. Content pillar 与课程承接

每个 pillar 必须同时记录学习阶段、实际模块 ID、真实任务、免费内容最小结果、证据形式、转化桥、交付支持状态和适配分上限。模块引用由 `product:check` 校验；不存在的模块会让检查失败。

“互联网产品经理视角”不是独立 pillar，而是应用到所有内容的 `editorial_lens`：定义问题、明确目标、建立标准、选择工具、设计工作流、设置验收、复盘迭代。

## 8. 产品适配分上限

`confirmed_delivered=10`、`confirmed_partial=7`、`confirmed_container=5`、`direction_confirmed_delivery_unverified=3`、`unknown=0`。未知模块的 API 结果也是 0。

产品适配是候选题评分的一部分，不能覆盖用户价值和证据不足；与 AI 相关不自动得到分数。

## 9. CTA 规则

CTA 只有 `none`、`light` 和 `club`。未知模块只返回 `none`；容器和方向可以做保守提示，但不能 `club`；只有已交付或已确认部分交付模块，在内容完整解决一个小问题且直接相关时，才允许 `club`。

## 10. 未来每日选题器必须读取的字段

从 `config/product.yaml` 读取：

- `positioning`、`audience`、`learning_method`、`mechanisms`。
- `learning_architecture`、`delivery_catalog` 和 `delivery_status`。
- `pricing.current_offer`、`pricing.standard_price` 与早鸟未知状态。
- `claims.confirmed`、`claims.evidence_required`、`claims.forbidden`、`unknown_fields`。

从 `config/content-fit.yaml` 读取：

- `learner_stages`、`content_pillars`、`module_mapping`。
- `fit_rules.delivery_status_score_caps`、`cta_rules` 和 `editorial_lens`。

从 `config/project.yaml` 读取 `content_mix`。正式销售内容每次重新加载价格，不缓存旧价格。

## 11. 产品变化时怎样更新

先按事实优先级取得证据，再更新 `config/product.yaml`。交付状态改变后，人工检查是否需要同步 `config/content-fit.yaml` 的 pillar 支持状态、上限、CTA 和 `config/project.yaml` 比例。随后运行：

```bash
npm run product:check
npm run schema:generate
npm run schema:check
npm run typecheck
npm test
```

文档只在配置通过后同步。旧证据、海报方向或策略表现不能独立把未知权益升级为已交付。

## 12. 未来 Agent 不得擅自补全

- 会员人数、教程数量、项目数量、案例总数、模板数量。
- 固定更新频率、固定答疑频率、即时响应、作业批改、直播或一对一支持。
- 保证学会、收入、就业、业务结果、成功率。
- 退款、续费、会员有效期细则。
- 剩余名额、涨价日期或倒计时。
- AI 视频的完整课程范围。
- 任何 claim 白名单之外的权益。

未知 claim ID 默认拒绝；需证据 claim 没有 evidence reference 时拒绝；禁止 claim 永远拒绝。
