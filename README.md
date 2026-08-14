# AI Auto Content

面向已经接触 AI、但还没有稳定用起来和形成完整工作流的人构建的每日自主内容系统。

项目以互联网产品经理「七天假」为内容主体。系统每天自动感知和整理素材，后续阶段再逐步接入自主选题、研究写作、发布包和数据复盘；人保留最终审核、上传与发布责任。

> 系统每天运行，但不要求每天发布。没有足够高质量的题目时，后续选题阶段必须允许输出 `NO_PUBLISH`。

## 当前阶段：产品真相层 v2 + 已有素材采集运行时

PR #4 只建立每日选题器之前的产品底盘：`config/product.yaml` 是唯一机器可读产品事实源，`config/content-fit.yaml` 保存学习阶段、内容 pillar、产品适配分上限与 CTA 策略假设。本阶段不实现每日选题、`NO_PUBLISH` 决策、模型调用、写作、配图或发布。

Cloud Collector 与 Local Browser Collector 是两个独立运行通道。Cloud 在 GitHub Actions 每天北京时间 09:00 运行；本机 Browser 调度器每 15 分钟做一次轻量到期检查，在北京时间 07:30—12:00 窗口内只执行一次 X 与微信公众号早晨采集。手动 `local:morning` 可在窗口外运行一次，但仍服从锁、当天已完成和最多尝试次数保护。

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

Local Browser Runtime 使用独立 clone：`~/Library/Application Support/AiAutoContent/runtime`。状态、锁和配置保存在 Runtime clone 外部，日志写入 `~/Library/Logs/AiAutoContent/`。默认不自动启动 Chrome；必须提前打开 Chrome、保持 X 登录并连接 Browser Bridge。安装器与 LaunchAgent 模板已经提供；PR #4 和 CI 都不修改或安装 LaunchAgent。

Morning 的共享健康检查只以 Node、npm、OpenCLI、Chrome、daemon、Extension 和 Connectivity 判断是否阻断整条流水线。X 登录探测与公众号公开搜索探测彼此独立；单个平台失败时，另一个平台仍会采集，已有成功数据继续落盘、生成报告并安全同步 Git，只有两个平台都失败时整次 Browser Pipeline 才为 `failed`。

小红书已因用户主动降低账号与自动化风险的产品决策退出采集、内容生产、发布和复盘范围。旧材料 Schema 继续兼容历史 `source_platform`，过去的实测审计文档保持原样，不得据此重新启用活跃命令。详见 `docs/18-platform-scope-decision.md`。

产品真相层的所有校验均为离线确定性处理，不调用大模型，也不访问 X、公众号或 Browser Bridge。

## 快速开始

需要 Node.js 20 和 npm：

```bash
npm ci
npm run typecheck
npm run product:check
npm run schema:check
npm test
npm run collect:fixture
npm run local:scheduler -- --once --fixture --dry-run --now=2026-08-14T00:00:00.000Z
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
npm run local:scheduler -- --once
npm run local:install -- --dry-run
npm run local:uninstall -- --dry-run
```

`local:morning -- --dry-run` 不受调度窗口限制，仍会执行健康检查和真实 X / 公众号 Browser dry-run，但不会写状态、正式数据、报告或 Git；它仍使用运行锁。CI 只允许运行 `--fixture --dry-run`，不会访问平台、Chrome 或 OpenCLI Browser Bridge。生产安装必须由用户在 PR 合并后显式执行：

```bash
npm run local:install -- --install
```

仍保留的人工诊断命令：

```bash
npm run spike:opencli
npm run collect:browser -- --dry-run
```

`--dry-run` 会真实执行 preflight/采集，但不会写入正式数据目录。`collect:fixture` 只使用本地 Fixture，不访问网络。2026-08-13 本机最终 dry-run 已验证成功；后续仍必须以当次 `opencli doctor` 和平台返回为准，不能把历史成功或 Fixture 成功当成当前在线状态。

Local Runtime 退出码：0 表示成功、部分成功、未到期、当天已完成或锁占用；1 为参数/程序错误；2 为 Browser Pipeline 完全失败；3 为环境检查失败；4 为登录失效；5 为平台 blocked；6 为 Git 同步失败；7 为非法暂存路径。

## 自动运行

`.github/workflows/daily-material-collection.yml` 支持：

- 每天 UTC 01:00，即北京时间 09:00 定时运行。
- 在 GitHub Actions 页面通过 **Run workflow** 手动运行。
- Node.js 20、`npm ci`、类型检查、测试和真实采集。
- Workflow 只执行 `npm run collect:cloud`，不启动 OpenCLI、Codex Browser、Chrome 或 Playwright。
- 只暂存素材、状态、运行日志和日报；没有变化时不创建空提交。

仓库需在 **Settings → Actions → General → Workflow permissions** 中允许 **Read and write permissions**，否则 `GITHUB_TOKEN` 无法推送自动采集结果。

## 输出目录

```text
config/sources.yaml                 已核验的 RSS / Atom 信源
config/scoring.yaml                 评分关键词、权重、阈值与采集参数
config/platform-queries.yaml        浏览器平台关键词、预算与轮换
config/product.yaml                 唯一机器可读产品事实与 claim 真相源
config/content-fit.yaml             学习阶段、内容承接、适配上限与 CTA 策略
data/materials/YYYY-MM-DD.jsonl     最近 7 天内及隔离区 RSS 素材
data/browser-materials/YYYY-MM-DD.jsonl  浏览器非 dry-run 素材
data/browser-runs/                  浏览器平台运行日志
data/weixin-articles/YYYY-MM-DD/<material_id>/  已下载的公众号正文；同标题素材仍有独立目录
data/state/seen-materials.json      跨天 URL 与内容指纹
data/runs/run_*.json                每次运行及逐信源日志
reports/materials/YYYY-MM-DD.md     每日素材日报
reports/browser/YYYY-MM-DD.md       X / 公众号 Browser 素材日报
```

首次运行时，7 天以前的 RSS 只写入指纹状态，不写入当天素材；发布时间未知的素材进入 `quarantined`。缺失互动字段保存为 `null`，不以 0 冒充真实数据。

正式公众号正文以稳定 `material_id` 作为下载目录，重复运行仍命中同一目录，同一天标题相同但身份不同的文章不会互相覆盖。素材中的 `content_path` 只保存仓库相对 POSIX 路径；dry-run 固定为 `null`，命令摘要中的输出位置固定显示为 `[runtime-output]`。

自动 push 前会逐个验证 `origin/main..HEAD` 的所有 pending commit：提交标题必须是 `chore(browser-data): collect X and WeChat YYYY-MM-DD` 且日期真实有效，变更路径只能属于四个 Browser 数据白名单，并按每个 commit 当时的文件内容扫描临时微信参数、认证信息、本机绝对路径和 `.DS_Store`。删除白名单文件允许通过；任何提交不可读或不合规都会以 `invalid_staged_paths` 停止，且不 rebase、不 push、不访问平台。恢复到的 pending 日期只有包含今天时才跳过当天采集；只恢复历史日期后仍继续今天的健康检查和采集。

## JSON Schema 数据契约

- `schemas/unified-material.schema.json`：Browser Collector 和跨来源核心素材契约，对应 `unifiedMaterialSchema`。
- `schemas/material-card.schema.json`：Cloud Material 完整契约，对应 `materialSchema`。
- `schemas/product-profile.schema.json`：产品事实、交付状态、价格和 claim 契约，对应 `productProfileSchema`。
- `schemas/content-fit-profile.schema.json`：学习阶段、pillar、模块映射、适配上限与 CTA 契约，对应 `contentFitProfileSchema`。

四份提交文件都从 Zod Schema 生成。修改运行时模型后执行 `npm run schema:generate` 更新文件；`npm run schema:check` 会在临时目录重新生成并比较，发现漂移时返回非零退出码。`npm run product:check` 额外校验模块引用、claim 唯一性、内容比例和状态分数上限。PR CI 会运行这些检查，过程不访问真实平台或模型。

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

发生冲突时，真实性与合规规则、人物事实库和产品知识库优先。资料不足时必须标记 `UNKNOWN`，不得自行补全。

## 明确不做

- 为了日更制造垃圾内容。
- 单纯搬运 AI 新闻。
- 编造个人经历、测试、用户案例、收入或数据。
- 通过伪造生活细节制造“真人感”。
- 以规避平台审核、检测或标注要求为目标。
- 在未经确认时承诺课程权益、更新频率或学习结果。
- 在当前阶段接入数据库、大模型或自动发布。
- 在 GitHub-hosted runner 上运行需要真实 Chrome 登录态的采集。
