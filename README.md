# AI Auto Content

面向已经接触 AI、但还没有稳定用起来和形成完整工作流的人构建的每日自主内容系统。

项目以互联网产品经理「七天假」为内容主体。系统每天自动感知和整理素材，后续阶段再逐步接入自主选题、研究写作、发布包和数据复盘；人保留最终审核、上传与发布责任。

> 系统每天运行，但不要求每天发布。没有足够高质量的题目时，后续选题阶段必须允许输出 `NO_PUBLISH`。

## 当前阶段：Provisional Profile 等待写作效果审核

产品真相层、素材采集、每日选题和研究已经进入 production。写作包 v0 只在 Research Pack 为 `READY_FOR_WRITING` 后解析本机 Style Approval Chain；当前旧 Receipt 通过 Binding Attestation 技术补链，状态为 `valid_legacy_receipt_with_binding_attestation`，不等于重新审批或 production approved。Provisional Profile 只能在显式传入三个 Style 路径、`--allow-provisional-style` 与 dry-run / Synthetic READY Fixture 时使用。Scheduler 只接受未来的 approved Profile，Human Send Gate 永远开启。

> 本机 Codex CLI 不是离线模型。只有同一 Profile 的全部语料在 CLI 或可信本地 Manifest 中明确 `model_processing=allowed` 才可发送给 Codex 服务；任一文档 denied 时连 Codex CLI 版本、帮助或登录探测都不会触发，也不要求 `STYLE_CODEX_MODEL`。JSONL 正文不能决定或覆盖 rights/consent。Protected Index 只供 Reviewer 使用，绝不进入 Writer。

Corpus Root、Corpus 内文件和 Source File 都拒绝 symlink，并用 `realpath` 复验仓库边界；私有文件以 `0600` 同目录临时文件、fsync 和 atomic rename 写入。Public Reference 的 Index 与 Profile 共用同一个完整 Corpus Hash；`style:lint` 遇到缺失、过期、损坏或不安全 Index 会 fail closed。`npm run style:protected:inspect -- --profile-id <id>` 只显示 hash、状态和分类数量，不显示受保护短语。

| 系统阶段 | 状态 |
|---|---|
| 采集 | `production` |
| 产品真相层 | `production` |
| 每日选题 | `production` |
| 研究与实验 | `production` |
| 风格智能 | `provisional_profile_pending_writing_validation` |
| 写作 | `implemented_pending_live_validation` |
| 配图 | `not_started` |
| 发布 | `not_started` |

## Synthetic live Codex integration validation

在执行前 PR Head `b9c4df754075fc1ebc2a02dc94be1069a291ccd0` 上，`codex-cli 0.147.0` 使用 `gpt-5.6-sol` 完成项目自有合成 Owner/Reference 各 8 篇的真实集成验证。Owner 与 Reference 外层 Distill 各执行 1 次，内部 Codex 均为 1 次调用并返回 `ready`；Reference Index 为 `ready`，分类计数为 2/1/1/1。非 Fixture Recipe 使用 owner 0.80 / reference 0.20，Selected Rules 为 10/2；正常 Lint 通过，Protected Transfer 成功 hard block，stale Index 返回 `protected_index_stale`。

验证显式清除 API/GitHub Token 环境，没有访问平台或网页；合成 Corpus、Profile、Index、Codex 结果和临时脚本都没有进入 Git。该结果只把风格智能推进到 `implemented_live_provider_verified_pending_real_corpus`，不是 production，仍等待真实语料及其逐篇来源、权利和模型处理授权。

Cloud Collector 与 Mac Local Runtime 是两个独立运行通道。Cloud 在 GitHub Actions 每天北京时间 09:00 运行；本机 LaunchAgent 每 15 分钟做一次轻量到期检查：07:30—12:00 执行 X/微信公众号 Morning，13:00—18:00 执行 Topic Selection，13:30—21:00 执行 Research Pack，14:30—22:00 检查 Writing Pack。Writing Scheduler 不自动消费 Provisional Profile，本 PR 不安装或 reload LaunchAgent。

| 模块 | 状态 | 是否每日运行 |
|---|---|---|
| RSS | `verified_live` | 是 |
| AIHOT | `verified_live` | 是 |
| OpenCLI X | `verified_live` | 本机独立通道 |
| OpenCLI 公众号 | `verified_live` | 本机独立通道 |
| Codex Browser | `exploration_only` | 否 |

```text
Cloud Collector（GitHub Actions）→ RSS / AIHOT / 公开来源
Local Browser Collector（用户 Mac）→ X / 微信公众号
→ 限流采集并隔离单源、单平台和单条失败
→ 标准化字段和规范 URL
→ 保存 Browser JSONL、运行日志、公众号正文和 Markdown 日报
→ 只暂存 Browser 数据白名单
→ pull --rebase 后安全 push main
```

Local Runtime 使用独立 clone：`~/Library/Application Support/AiAutoContent/runtime`。状态、锁、配置和 Topic Judge 临时目录保存在 Runtime clone 外部，日志写入 `~/Library/Logs/AiAutoContent/`。Morning 默认不自动启动 Chrome；Topic Judge 在只读 Sandbox 的独立非 Git 目录运行。PR 与 CI 都不修改、安装或 reload LaunchAgent。

Morning 的共享健康检查只以 Node、npm、OpenCLI、Chrome、daemon、Extension 和 Connectivity 判断是否阻断整条流水线。X 登录探测与公众号公开搜索探测彼此独立；单个平台失败时，另一个平台仍会采集，已有成功数据继续落盘、生成报告并安全同步 Git，只有两个平台都失败时整次 Browser Pipeline 才为 `failed`。

小红书已因用户主动降低账号与自动化风险的产品决策退出采集、内容生产、发布和复盘范围。旧材料 Schema 继续兼容历史 `source_platform`，过去的实测审计文档保持原样，不得据此重新启用活跃命令。详见 `docs/18-platform-scope-decision.md`。

产品真相层的所有校验均为离线确定性处理，不调用大模型，也不访问 X、公众号或 Browser Bridge。

## 快速开始

需要 Node.js 20 和 npm：

```bash
npm ci
npm run typecheck
npm run product:check
npm run writing-skills:check
npm run schema:check
npm test
npm run collect:fixture
npm run topic:select -- --fixture --date=2026-08-14
npm run topic:inspect-input -- --date=2026-08-14
npm run research:build -- --fixture --date=2026-08-14
npm run writing:build -- --fixture --date=2026-08-14
npm run style:distill -- --fixture
npm run style:protected:inspect -- --profile-id <id>
npm run style:lint -- --fixture
npm run local:scheduler -- --once --fixture --dry-run --now=2026-08-14T05:30:00.000Z
npm run local:morning -- --fixture --dry-run --now=2026-08-14T06:00:00.000Z
npm run local:install -- --dry-run
```

正式 Cloud Collector：

```bash
npm run collect:cloud
npm run collect:cloud -- --date=2026-08-12
npm run collect:cloud -- --dry-run
```

AIHOT 默认使用项目自身身份：

```text
AI-Auto-Content/0.2 (+https://github.com/wangguoqing123/Ai-auto-content)
```

如拥有 AIHOT Actor UUID v4，可在 shell 或任务运行环境中配置 `AIHOT_ACTOR_ID`；`.env.example` 只提供变量模板，程序不会自动加载本地 `.env`。缺失或非法值不会阻断 Cloud Collector，也不会把 Actor 值写入日志。项目继续只访问 `https://aihot.virxact.com/api/v1/*`。

本机 Browser Runtime 命令：

```bash
npm run opencli:install-adapters
npm run local:check
npm run local:morning -- --dry-run
npm run local:topic -- --dry-run
npm run local:research -- --dry-run
npm run local:writing -- --dry-run
npm run local:scheduler -- --once
npm run local:install -- --dry-run
npm run local:uninstall -- --dry-run
```

`local:morning -- --dry-run` 不受调度窗口限制，仍会执行健康检查和真实 X / 公众号 Browser dry-run；`local:topic -- --dry-run` 不访问平台；`local:research -- --dry-run` 只允许访问 Topic 指定的官方 fact_source 并运行文本实验。三者都不写状态、正式数据、报告或 Git。CI 只运行 Fixture，不访问真实 Codex、网页、平台、Chrome 或 Browser Bridge。生产安装必须由用户在 PR 合并后显式执行，并配置模型：

```bash
export TOPIC_CODEX_MODEL="<explicit model>"
npm run local:install -- --install
```

安装器把同一个本机 Codex CLI 与显式模型同时提供给 Topic 和 Research；手动运行时仍可用 `RESEARCH_CODEX_BIN` / `RESEARCH_CODEX_MODEL` 单独覆盖。

仍保留的人工诊断命令：

```bash
npm run spike:opencli
npm run collect:browser -- --dry-run
```

`--dry-run` 会真实执行 preflight/采集，但不会写入正式数据目录。`collect:fixture` 只使用本地 Fixture，不访问网络。2026-08-13 本机最终 dry-run 已验证成功；后续仍必须以当次 `opencli doctor` 和平台返回为准，不能把历史成功或 Fixture 成功当成当前在线状态。

Local Runtime 退出码：0 表示成功、部分成功、未到期、当天已完成或锁占用；1 为参数/程序错误；2 为 Browser Pipeline 或模型结构输出失败；3 为环境/Provider 不可用；4 为登录或配置失败；5 为平台 blocked；6 为 Git 同步失败；7 为非法暂存路径。

## 自动运行

`.github/workflows/daily-material-collection.yml` 支持：

- 每天 UTC 01:00，即北京时间 09:00 定时运行。
- 在 GitHub Actions 页面通过 **Run workflow** 手动运行。
- Node.js 20、`npm ci`、类型检查、测试和真实采集。
- Workflow 只执行 `npm run collect:cloud`，不启动 OpenCLI、Codex Browser、Chrome 或 Playwright。
- 只暂存素材、状态、运行日志和日报；没有变化时不创建空提交。

仓库需在 **Settings → Actions → General → Workflow permissions** 中允许 **Read and write permissions**，否则 `GITHUB_TOKEN` 无法推送自动采集结果。

真实每日选题与研究不在 GitHub Actions 运行，也不需要 `OPENAI_API_KEY`。Mac Local Runtime 分别在 13:00—18:00 和 13:30—21:00 调用 `codex_cli`；PR Validation 只运行离线 Topic / Research Fixture。无 Topic 时 Research 不创建 Provider 或抓取网页。

## 输出目录

```text
config/sources.yaml                 已核验的 RSS / Atom 信源
config/scoring.yaml                 评分关键词、权重、阈值与采集参数
config/platform-queries.yaml        浏览器平台关键词、预算与轮换
config/product.yaml                 唯一机器可读产品事实与 claim 真相源
config/content-fit.yaml             学习阶段、内容承接、适配上限与 CTA 策略
config/topic-intelligence.yaml      72 小时输入、预算、门槛、历史和模型调用上限
config/research-intelligence.yaml   公共抓取、引用、Codex、实验与调度上限
config/writing-intelligence.yaml    写作调用、平台权重、字数、价格和调度上限
config/experiment-task-catalog.yaml 三个项目自带合成 text_to_text 实验任务
data/materials/YYYY-MM-DD.jsonl     最近 7 天内及隔离区 RSS 素材
data/browser-materials/YYYY-MM-DD.jsonl  浏览器非 dry-run 素材
data/browser-runs/                  浏览器平台运行日志
data/weixin-articles/YYYY-MM-DD/<material_id>/  已下载的公众号正文；同标题素材仍有独立目录
data/state/seen-materials.json      跨天 URL 与内容指纹
data/runs/run_*.json                每次运行及逐信源日志
reports/materials/YYYY-MM-DD.md     每日素材日报
reports/browser/YYYY-MM-DD.md       X / 公众号 Browser 素材日报
data/topic-decisions/YYYY-MM-DD.json  当日正式 SELECT_TOPIC / NO_PUBLISH 决定
data/topic-runs/topic_*.json        每次选题运行的安全审计记录
reports/topics/YYYY-MM-DD.md        单一最终母题或 NO_PUBLISH 日报
data/research-packs/YYYY-MM-DD/     Research Pack、短引用来源清单与合成实验结果
data/research-runs/research_*.json  每次研究运行的安全审计记录
reports/research/YYYY-MM-DD.md      不含正文的研究与实验报告
data/writing-packs/YYYY-MM-DD/      未来仅 approved Style 正式写入的母稿、公众号和单一 X 包
data/writing-runs/writing_*.json    未来 approved Style 的写作安全审计记录
reports/writing/YYYY-MM-DD.md       未来 approved Style 的 Human Gate 报告
~/Library/Application Support/AiAutoContent/writing-review/  0700/0600 本机 Synthetic 写作效果审阅包
~/Library/Application Support/AiAutoContent/style-corpus/  0700/0600 本机私有语料、反馈和 Profile 缓存，不进入 Git
```

首次运行时，7 天以前的 RSS 只写入指纹状态，不写入当天素材；发布时间未知的素材进入 `quarantined`。缺失互动字段保存为 `null`，不以 0 冒充真实数据。

正式公众号正文以稳定 `material_id` 作为下载目录，重复运行仍命中同一目录，同一天标题相同但身份不同的文章不会互相覆盖。素材中的 `content_path` 只保存仓库相对 POSIX 路径；dry-run 固定为 `null`，命令摘要中的输出位置固定显示为 `[runtime-output]`。

自动 push 前会逐个验证 `origin/main..HEAD` 的所有 pending commit：标题只能是 Browser、Topic 或 Research 固定格式，日期必须真实，变更路径必须属于对应白名单，并按 commit 时点内容扫描严格 Schema、第三方全文、临时参数、认证信息、本机绝对路径和 `.DS_Store`。任何提交不可读或不合规都会以 `invalid_staged_paths` 停止；Morning、Topic 与 Research 分别按恢复日期判断是否已完成。

## JSON Schema 数据契约

- `schemas/unified-material.schema.json`：Browser Collector 和跨来源核心素材契约，对应 `unifiedMaterialSchema`。
- `schemas/material-card.schema.json`：Cloud Material 完整契约，对应 `materialSchema`。
- `schemas/product-profile.schema.json`：产品事实、交付状态、价格和 claim 契约，对应 `productProfileSchema`。
- `schemas/content-fit-profile.schema.json`：学习阶段、pillar、模块映射、适配上限与 CTA 契约，对应 `contentFitProfileSchema`。
- `schemas/topic-decision.schema.json`：每日选题成功/失败、单一母题和最多 3 个候选契约，对应 `topicDecisionSchema`。
- `schemas/research-pack.schema.json`：研究决定、来源短引用、Claim、问题答案、实验和写作门槛契约，对应 `researchPackSchema`。
- `schemas/style-profile.schema.json`：三类风格蒸馏结果、确定性指标、版权与禁迁移契约，对应 `styleProfileSchema`。
- `schemas/style-distillation-bundle.schema.json`：单次 Distill 同时返回 Profile Fragment 与受保护候选的严格契约。
- `schemas/protected-transfer-index.schema.json`：本机 Reviewer Index 的来源、精确子串与 hash 契约。
- `schemas/style-recipe.schema.json`：Owner/Reference/平台权重、动态文体选择和 fallback 契约，对应 `styleRecipeSchema`。
- `schemas/writing-pack.schema.json`：Research、Style、结构化 Blocks、公众号、单一 X、六类审计与 Human Gate 契约。
- `schemas/provisional-style-profile.schema.json`：当前私有 Provisional Overlay 的严格只读契约。
- `schemas/style-approval-receipt.schema.json`：Receipt v1/v2 契约。
- `schemas/style-approval-binding-attestation.schema.json`：Legacy Receipt 技术补链契约。

十八份提交文件都从 Zod Schema 生成。修改运行时模型后执行 `npm run schema:generate` 更新文件；`npm run schema:check` 会在临时目录重新生成并比较，发现漂移时返回非零退出码。PR CI 使用 Fixture 运行 Topic、Research、Writing、风格蒸馏和写作 Lint，不访问真实网页、平台或模型。

## 项目目标

- 服务已经开始接触 AI、但还没有稳定用起来和形成完整方法的人，而不是只服务技术从业者。
- 建立「互联网产品经理拆 AI」的稳定个人品牌。
- 用真实用户问题、可靠资料和真实实验形成内容壁垒。
- 将合适用户自然承接到「AI 不掉队俱乐部」。
- 以合格咨询和付费转化作为长期指标，而不是发文数量。

## 当前已确认的产品事实

- 产品名称：AI 不掉队俱乐部
- 当前价格：365 元/年
- 产品形态：以学习路径、基础课程、工具实操、完整项目、真实案例和社群交流支持实践的长期学习社群
- 核心主张：不是追每一个新工具，而是把 AI 真正用起来
- 当前标准价格：499 元/年；剩余早鸟名额未知，不能自动生成名额或涨价倒计时
- 已确认交付：会员首页、学习路径、小白基础课、AI 内容自动化、Codex 基础课、Codex 15 个实操场景和常见问题帮助
- 方向已确认但完整交付未验证：AI 视频生产

详细状态、证据和 claim 白名单只读取 `config/product.yaml`。更新频率、答疑频率、课程数量、会员人数、退款规则等未确认信息，不得由 AI 自动补全。

## 文档阅读顺序

1. `docs/00-project-charter.md`
2. `docs/01-account-positioning.md`
3. `docs/02-persona-facts-and-opinions.md`
4. `docs/03-product-knowledge-base.md`
5. `docs/04-content-strategy.md`
6. `docs/05-quality-truth-and-compliance.md`
7. `docs/06-platform-guidelines.md`
8. `docs/07-system-architecture.md`
9. `docs/08-data-model.md`
10. `docs/09-mvp-roadmap.md`
11. `docs/10-daily-operation-loop.md`
12. `docs/12-ugc-originality-policy.md`
13. `docs/13-source-capability-matrix.md`
14. `docs/14-opencli-live-capability-spike.md`
15. `docs/15-hybrid-collector-runtime.md`
16. `docs/16-codex-browser-runtime-spike.md`
17. `docs/17-opencli-browser-live-validation.md`
18. `docs/18-platform-scope-decision.md`
19. `docs/19-local-browser-scheduler.md`
20. `docs/20-product-truth-and-content-fit.md`
21. `docs/21-daily-topic-intelligence.md`
22. `docs/22-research-and-experiment-packs.md`
23. `docs/23-style-intelligence-and-writing-skills.md`
24. `docs/24-evidence-constrained-writing-packs.md`

发生冲突时，真实性与合规规则、人物事实库和产品知识库优先。资料不足时必须标记 `UNKNOWN`，不得自行补全。

## 明确不做

- 为了日更制造垃圾内容。
- 单纯搬运 AI 新闻。
- 编造个人经历、测试、用户案例、收入或数据。
- 通过伪造生活细节制造“真人感”。
- 以规避平台审核、检测或标注要求为目标。
- 在未经确认时承诺课程权益、更新频率或学习结果。
- 在当前阶段接入数据库、自动发布或模型驱动正文生产。
- 在 GitHub-hosted runner 上运行需要真实 Chrome 登录态的采集。
