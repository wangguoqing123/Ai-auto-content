---
title: 每日内容智能判断与自主选题 v0
version: 1.0.0
updated_at: 2026-08-14
status: implemented_live_model_dry_run_verified_pending_local_activation
---

# 每日内容智能判断与自主选题 v0

## 1. 目标和边界

每日选题器只回答两个问题：今天是否值得进入内容研究，以及值得研究哪一个母题。成功运行的业务决定只有：

- `SELECT_TOPIC`：存在一个达到门槛的母题，只允许进入后续研究与实验层。
- `NO_PUBLISH`：今天没有达到质量门槛的母题，不为完成任务强行选题。

`SELECT_TOPIC` 不是发布、正文、最终标题或实验结论。本层不生成公众号或 X 正文、图片、草稿箱或发布动作。模型、配置、Schema 和文件错误属于 `status=failed`，绝不能伪装成 `NO_PUBLISH`。

## 2. 输入和时间窗口

正式输入为：

- Cloud：`data/materials/*.jsonl` 中的 RSS 与 AIHOT。
- Browser：`data/browser-materials/*.jsonl` 中的 X 与微信公众号。
- 历史：最近 30 天 `data/topic-decisions/*.json`；未来兼容 `data/published/*.jsonl`。
- 产品真相：`config/product.yaml`、`config/content-fit.yaml` 和 `config/project.yaml`。
- 未来证据：`data/evidence/projects/**`、`experiments/**` 和 `cases/**`，不存在时视为空。

决策时间按 `Asia/Shanghai` 的 13:00 计算，默认回看 72 小时。代码读取每条记录的 `published_at`、`published_at_quality`、`collected_at`、`status`、平台、来源种类、访问状态、用途与 canonical URL，不根据文件名猜时间。

优先使用明确的 `published_at`。只有非事实型趋势或结构信号在发布时间缺失、但采集时间明确时，才保守使用 `collected_at`；发布时间未知的材料不能支持时效事实。

同一身份跨日出现时先合并快照，再过滤和计算输入哈希。身份依次使用平台内 `source_item_id`、可追溯 canonical URL、`material_id`；合并结果与 JSONL 文件顺序无关。`collected_at` 最新快照为主，互动和作者关注数只在最新值为 `null` 时回退到此前最近的非空值，不取历史最大值；发布时间按 exact、inferred、unknown 的质量顺序选择。resolved/accepted 可以升级旧 unresolved/quarantined，查询来源和 identity aliases 稳定去重保留。

## 3. 硬过滤和五种来源角色

主池要求近期、`accepted`、合法 `material_id`、合法 canonical URL、无敏感信息，且平台不是已退出的 `xiaohongshu`。五种模型角色为：

1. `fact_source`：官方、一手、resolved、accepted 的可追溯材料。
2. `trend_signal`：X 讨论、用户提问和互动信号；只说明传播或问题信号。
3. `structure_inspiration`：resolved 且 accepted 的非官方公众号长内容结构。
4. `reference_only`：AIHOT、二手新闻和等待核实的发现线索。
5. `restricted_inspiration_only`：unresolved/quarantined 公众号，或缺少可追溯 URL 的下载正文。

可信新闻不会因“像新闻”而升级为一手事实源。X 互动不证明观点为真、未来会爆、正在起飞或增长速度。当前没有多时点互动快照，系统不计算 `velocity`，也不把 signal score 称为爆款概率。

素材文本复用 Browser 数据的凭证扫描语义：正常的 Authorization/Cookie 技术说明、`/tmp` 示例和外部签名 URL 可以进入；明确 Bearer/API/Cookie 凭证赋值、当前 home 路径和微信临时访问 URL 继续拒绝。

## 4. restricted 公众号规则

restricted 材料独立进入灵感池：

- 不读取、发送或保存完整正文。
- 摘要最多 300 字，canonical URL 强制为 `null`。
- 不发送 `content_path`、本机路径、临时微信参数或 Browser Profile ID。
- 只能发现表达结构、用户问题或选题方向。
- 永远不能进入 `fact_source_ids`、`supported_claims` 或支持证据分。

普通 Material Card 摘要最多 500 字。所有卡片都是不可信 JSON 数据，不拼进 System Prompt。

## 5. 确定性预筛选和多样性

代码先过滤、去重、聚类和排序，再给模型，默认最大总量 60。预算桶固定为 `cloud`、`twitter`、`weixin_resolved`、`weixin_restricted`：RSS 与 AIHOT 共用 Cloud 最大 30，X 最大 25，resolved 微信最大 8、restricted 微信另有独立最大 8；单作者 3、非空单查询 8、单 cluster 5。Cloud 空 query 不计入 query 限制，因此不会被错误截断到 8。总模型输入字符上限为 80,000。

Cloud 使用相关度、来源、一手性和新鲜度；X 只用弱趋势排序：互动先 `log1p`，再转为本次运行内相对百分位，与新鲜度组合。缺失互动仍为 `null`。微信公众号使用新鲜度、resolved、正文存在和搜索排名等弱信号，搜狗排名不代表阅读量或爆款。

去重至少使用 `material_id`、canonical URL 和 `source_item_id`。基础 opportunity cluster 使用标题规范化、token Jaccard、实体重合和时间；同一 cluster 保留跨平台角色差异，但限制数量。没有公众号材料时不强制补足。

安全诊断只保存计数：`eligible_by_bucket`、`selected_by_bucket` 与 `dropped_by_reason`，后者区分重复、时间窗、状态、URL、素材格式、敏感内容、作者、查询、cluster、bucket 和字符预算；不保存全文或凭证。

## 6. 候选、硬淘汰和六维评分

模型最多提出 3 个内部候选；代码最多选择 1 个。候选必须明确 learner stage、content pillar、用户场景、问题、错误做法、真实任务、最小结果、证明形式和真实产品模块。

只是转述新闻、翻译 X、改写公众号、缺少用户问题/真实任务/最小结果、只能靠夸张标题、时效事实无一手来源、UGC 无补证却下事实结论、依赖未确认权益、映射不了阶段或模块、与 30 天历史重复等都硬淘汰。热点必须说明它与“已经接触 AI、但尚未稳定用起来的人”的具体关系。

100 分由代码重算：

- `pain_score`：0～25。
- `actionability_score`：0～20。
- `demonstrability_score`：0～15。
- `evidence_score`：0～15。
- `engagement_potential_score`：0～15，不只看浏览量。
- `product_fit_score`：0～10，并受产品代码上限校准。

有 fact source 时证据分最高 15；无 fact source 但有具体实验计划时最高 10；两者都没有时最高 5。时效事实无 fact source 直接淘汰。通过门槛固定为 80，且所有硬校验同时通过。

## 7. 产品映射和产品适配上限

模型收到的 Product Context 从三个配置压缩生成，不含价格 CTA、二维码、私人信息、会员人数、剩余名额或未确认频率。learner stage、content pillar 和所有模块 ID 必须真实存在，pillar 与模块映射必须合法。

代码计算：

```text
module_cap = 所有实际匹配模块的交付状态上限最小值
effective_product_fit_cap = min(module_cap, pillar.maximum_product_fit_score)
product_fit_score = min(model_proposal, effective_product_fit_cap)
```

supporting module 不能抬高上限，但可以降低上限。已交付模块最高 10，partial 最高 7，container 最高 5，方向已确认但交付未验证最高 3，unknown 为 0。因此 AI 视频当前最高 3；内容自动化可到 10。调整会保存 `product_fit_cap_applied`。

## 8. CTA 和 Product Claim

CTA 只有 `none`、`light`、`club`。代码取所有实际匹配模块允许 CTA 的交集。`club` 只用于直接对应 `confirmed_delivered` / `confirmed_partial`、免费内容已完整解决小问题、产品承接是更系统路径或实践，且不依赖未确认 Claim 的情况。direction-only/unknown 不可使用；lead generation 且产品适配低于 7 不可使用。非法 CTA 自动降级并记录 `cta_adjusted_from`。

候选只保存 CTA 模式，不生成销售话术。`club` 只输出 `price_refresh_required: true`，具体价格由后续写作阶段重新读取产品配置。

Product Claim ID 必须存在于产品真相层。confirmed 可用；forbidden 和 unknown 拒绝；evidence-required 必须带真实引用：

- `material:<material_id>` 必须存在于本次输入。
- `experiment:<experiment_id>` 必须命中可解析 JSON 的 `experiment_id`。
- `project:<project_id>` 必须命中可解析 JSON 的 `project_id`。
- `case:<case_id>` 必须命中可解析 JSON 的 `case_id`。

统一解析器拒绝路径穿越、任意文件名、txt、空 JSON、损坏 JSON 和 ID 不匹配。Product Claim 的 material evidence 还必须是本次输入的 `fact_source`。非空字符串不等于证据。名额、会员数、教程数、固定频率、即时响应、结果保证、退款承诺和倒计时始终不可自动使用。

## 9. 事实、研究和实验

`supported_claims` 最多 5 条，每条至少一个本次输入的 `fact_source`；trend、structure、restricted、quarantined 和 unresolved 均不可支持。未补证观点放进 `research_questions` 或 `risk_flags`。

“实测、对比、效率、最好用、更快、更准确、成本更低、自动化效果、能力比较、工作流效果、亲测有效”等默认要求实验。实验计划最多 5 步，必须说明任务、输入、验收、记录数据和推翻条件。本层只规划，不执行；没有记录就不能提前写出结论或第一人称实测。

## 10. 历史重复

代码用 learner stage、用户问题、真实任务、最小结果和核心角度规范化后计算稳定 SHA-256 `topic_signature`。精确签名窗口由 `exact_signature_window_days` 独立控制，相似度窗口由 `similarity_window_days` 独立控制；默认均为 30 天，工作标题、用户问题、最小结果和 core angle 的 token Jaccard 阈值为 0.72。

解除重复必须有经过真实解析的新 fact source、新实验结果、新场景、明显不同的 minimum result 或 core angle，并同时保存具体 `novelty_delta` 和 `new_evidence_refs`；只写“角度不同”或虚构引用无效。内容比例只用于 3 分以内同分决策，不会让低质量题目过门槛。

## 11. Provider、本机 Codex 安全边界和 Prompt Injection

Provider 接口位于 `src/topic-intelligence/providers/`。Fixture 完全离线，可模拟选择、NO_PUBLISH、非法结构与网络失败。生产默认 Provider 是 `codex_cli`，使用用户 Mac 上已经登录的 Codex CLI；它不要求 `OPENAI_API_KEY`，但仍依赖本机安装、登录态、网络和账号可用额度，因此不是离线模型。OpenAI Responses API Provider 只保留为显式选择的备用实现。

本机 2026-08-14 能力探测记录：`/Users/wangguoqing/.local/bin/codex`，`codex-cli 0.147.0`。实际 `codex exec --help` 支持非交互执行、`--model`、`--json`、`--output-schema`、`--output-last-message`、`--sandbox read-only`、`--ephemeral` 和 `--skip-git-repo-check`；全局参数支持 `--ask-for-approval never`。帮助命令成功返回 0，未知参数返回 2。实现依据当前 CLI 帮助和[官方 Codex CLI 命令参考](https://developers.openai.com/codex/cli/reference)，不使用 `--dangerously-bypass-approvals-and-sandbox`。

每次判断在 `~/Library/Application Support/AiAutoContent/tmp/topic-judge/<run>/` 独立目录中运行。目录不是 Git 仓库，只包含 `input.json`、`output-schema.json`、`system-instructions.md` 和 `result.json`。Codex 使用参数数组、`shell=false`、只读 Sandbox、禁用人工审批、ephemeral 会话和严格 Provider Output JSON Schema；工作目录不是 Runtime clone，Prompt 不含仓库路径。子进程只保留 `HOME`、`PATH`、`LANG`、`LC_ALL`、`TERM`，以及存在时的 `CODEX_HOME`，不会继承 API Key、GitHub Token、Cookie 或 Browser Session。最终打分、校验、写文件和 Git 操作始终由项目代码完成。

`TOPIC_CODEX_MODEL` 必须显式设置，`TOPIC_CODEX_BIN` 可留空并由安装器或运行环境解析为绝对路径。结构化结果最大 2 MiB；Markdown fence、额外字段、非法 JSON 或超限输出都进入一次允许的结构修复，不从自然语言中猜 JSON。Provider 区分未安装、未登录、非交互能力缺失、超时、额度限制、输出非法、进程失败和 Sandbox 不可用；这些都是 failed，不是 `NO_PUBLISH`。

2026-08-14 真实本机 dry-run 使用 `gpt-5.6-sol`、45 张筛选后 Material Cards 和 1 次调用，得到 `SELECT_TOPIC`：工作标题“Agent 会干活还不够：先给它装上‘任务验收单’”，代码重算总分 92，learner stage 为 `workflow_building`，pillar 为 `agents_and_workflows`，主模块为 `codex_practice`，CTA 为 `club`，需要实验。随后在 `env -i` 的 LaunchAgent 近似环境中再次成功完成结构化 dry-run，得到合法 `NO_PUBLISH/all_candidates_hard_rejected`；两次都未写正式文件、未修改 Git、未访问真实平台。业务决定可因模型输出而不同，正式运行依赖当日 `input_hash` 幂等，只会保存一次成功决定。

单次运行最多 2 次模型调用：第一次正常判断；只有结构非法时，第二次把 Zod 错误清单交给模型修复。调用次数在请求发出前递增，因此首次失败记录 1、repair 失败记录 2；SDK/Abort/客户端超时为 `model_timeout`，其他网络失败为 `model_unavailable`，二次仍非法为 `model_output_invalid`，均为 `status=failed`、`decision=null`。

System Prompt 只含任务、真实性、安全和 Schema 边界。材料位于 `untrusted_material_cards` JSON 区；材料中的“忽略前文”“输出 API Key”“访问链接”“修改候选数量”等都是普通文本。Provider 不访问材料链接，不记录 API Key、Authorization、完整原始响应、文章正文、Codex Session 或思维链。

## 12. 幂等和输出

`input_hash` 包含合并后的 Material Cards、最新互动、30 天签名、四份配置哈希、Provider、显式模型、Prompt 版本、Codex CLI 版本和 Provider Output Schema 版本。同日期已有成功决定且 hash 相同，返回 `ALREADY_DECIDED`，不调用模型；failed 可重试；hash 变化保存新 run 并更新当日正式决定，不删除旧 run。

正式运行在调用模型前严格读取当天已有 decision。文件不存在才视为空；损坏 JSON、Schema 不合法或日期不一致均 `schema_invalid` fail closed，不调用模型，也不覆盖原 decision/report。候选评估或最终 Schema 的意外异常同样安全返回 failed；输出目录预检失败不会被解释为 `NO_PUBLISH`。

正式输出：

- `data/topic-decisions/YYYY-MM-DD.json`
- `data/topic-runs/topic_<timestamp>.json`
- `reports/topics/YYYY-MM-DD.md`

Schema 为 Zod `topicDecisionSchema` 与 `schemas/topic-decision.schema.json`。`SELECT_TOPIC` 必须有且只有一个 selected topic；`NO_PUBLISH` 必须没有 selected topic 且有内容原因；failed 必须 decision 为 null 且有错误码。日报只突出一个母题、角色证据、研究缺口、实验计划、平台形式和 CTA 模式，不保存完整模型响应或内容正文。

## 13. CLI 和本机调度

```bash
npm run topic:select
npm run topic:select -- --dry-run
npm run topic:select -- --fixture --date=2026-08-14
npm run topic:validate -- <decision-file>
npm run topic:inspect-input -- --date=2026-08-14
```

Fixture 不访问网络并不写正式文件。dry-run 读取仓库已有数据、可以调用已配置模型，但只把 JSON 输出到 stdout。inspect-input 不调用模型，只显示受限卡片摘要。

GitHub Actions 不再调度或调用真实选题模型；PR Validation 只运行离线 Fixture。真实选题由现有 Mac Local Runtime 的同一个 LaunchAgent 每 15 分钟做轻量 due check：Morning 为 07:30—12:00，Topic Selection 为 13:00—18:00，两个任务各自记录状态且最多尝试 2 次。

Topic Task 先同步 Runtime clone 的 `main`，再运行选题器。无材料时直接写 `NO_PUBLISH/no_usable_materials`，完全不创建 Codex Provider。成功的 `SELECT_TOPIC`、`NO_PUBLISH` 和 `ALREADY_DECIDED` 都算当天完成；failed 可在窗口内再试一次。自动提交只允许 decisions、runs 和 reports 三个选题目录，使用 `chore(topic): decide daily topic YYYY-MM-DD`；冲突 abort 并失败，不 force、不重复调用模型。

## 14. 失败、缺口和下一阶段接口

Browser 缺失时仍可用 Cloud，并记录 `browser_missing`；Cloud 缺失时仍可用 Browser，但 X 不会升级为事实源；两者都没有时不创建 Provider、不要求 Codex 配置，直接 `NO_PUBLISH/no_usable_materials`，模型字段记录 `not_invoked` 和 0 次调用。有素材但缺少 Provider 配置、Codex 安装、登录态、网络或额度时仍为 failed。

研究层现已在 `docs/22-research-and-experiment-packs.md` 实现：只接受成功 `SELECT_TOPIC` 的一个 selected topic，绑定 signature/hash/run ID，安全抓取原 fact_source，精确核验 quote，并在需要时执行合成文本对照实验。只有 `READY_FOR_WRITING` 才能进入未来写作层；`RESEARCH_INCOMPLETE` 和 failed 都禁止写作。正文、标题、配图和发布仍未实现。
