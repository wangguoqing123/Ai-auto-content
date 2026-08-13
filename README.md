# AI Auto Content

面向 AI 小白与轻度进阶用户的每日自主内容系统。

项目以互联网产品经理「七天假」为内容主体。系统每天自动感知和整理素材，后续阶段再逐步接入自主选题、研究写作、发布包和数据复盘；人保留最终审核、上传与发布责任。

> 系统每天运行，但不要求每天发布。没有足够高质量的题目时，后续选题阶段必须允许输出 `NO_PUBLISH`。

## 当前阶段：Cloud Collector + X / 微信公众号本机调度运行时

Cloud Collector 与 Local Browser Collector 是两个独立运行通道。Cloud 在 GitHub Actions 每天北京时间 09:00 运行；本机 Browser 调度器每 15 分钟做一次轻量到期检查，在北京时间 07:30—12:00 窗口内只执行一次 X 与微信公众号早晨采集。手动 `local:morning` 可在窗口外运行一次，但仍服从锁、当天已完成和最多尝试次数保护。

| 模块 | 状态 | 是否每日运行 |
|---|---|---|
| RSS | `verified_live` | 是 |
| AIHOT | `verified_live` | 是 |
| OpenCLI X | `verified_live` | 待合并后安装本机调度 |
| OpenCLI 公众号 | `verified_live` | 待合并后安装本机调度 |
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

Local Browser Runtime 使用独立 clone：`~/Library/Application Support/AiAutoContent/runtime`。状态、锁和配置保存在 Runtime clone 外部，日志写入 `~/Library/Logs/AiAutoContent/`。默认不自动启动 Chrome；必须提前打开 Chrome、保持 X 登录并连接 Browser Bridge。安装器与 LaunchAgent 模板已经提供，但本 PR 开发和 CI 不会正式安装。

小红书已因用户主动降低账号与自动化风险的产品决策退出采集、内容生产、发布和复盘范围。旧材料 Schema 继续兼容历史 `source_platform`，过去的实测审计文档保持原样，不得据此重新启用活跃命令。详见 `docs/18-platform-scope-decision.md`。

本阶段仍不调用大模型，不开发自动选题、写作、配图或发布。

## 快速开始

需要 Node.js 20 和 npm：

```bash
npm ci
npm run typecheck
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
data/materials/YYYY-MM-DD.jsonl     最近 7 天内及隔离区 RSS 素材
data/browser-materials/YYYY-MM-DD.jsonl  浏览器非 dry-run 素材
data/browser-runs/                  浏览器平台运行日志
data/weixin-articles/YYYY-MM-DD/    已下载的公众号正文；素材只记录仓库相对 POSIX 路径
data/state/seen-materials.json      跨天 URL 与内容指纹
data/runs/run_*.json                每次运行及逐信源日志
reports/materials/YYYY-MM-DD.md     每日素材日报
reports/browser/YYYY-MM-DD.md       X / 公众号 Browser 素材日报
```

首次运行时，7 天以前的 RSS 只写入指纹状态，不写入当天素材；发布时间未知的素材进入 `quarantined`。缺失互动字段保存为 `null`，不以 0 冒充真实数据。

## JSON Schema 数据契约

- `schemas/unified-material.schema.json`：Browser Collector 和跨来源核心素材契约，对应 `unifiedMaterialSchema`。
- `schemas/material-card.schema.json`：Cloud Material 完整契约，对应 `materialSchema`。

两份提交文件都从 `src/types.ts` 中的 Zod Schema 生成。修改运行时模型后执行 `npm run schema:generate` 更新文件；`npm run schema:check` 会在临时目录重新生成并比较，发现漂移时返回非零退出码。PR CI 会运行该检查，过程不访问真实平台或网络。

## 项目目标

- 服务 AI 小白和轻度进阶用户，而不是只服务技术从业者。
- 建立「互联网产品经理拆 AI」的稳定个人品牌。
- 用真实用户问题、可靠资料和真实实验形成内容壁垒。
- 将合适用户自然承接到「AI 不掉队俱乐部」。
- 以合格咨询和付费转化作为长期指标，而不是发文数量。

## 当前已确认的产品事实

- 产品名称：AI 不掉队俱乐部
- 当前价格：365 元/年
- 当前产品形态：社群交流 + AI 教程
- 已确认教程方向：AI 基础、自动化内容工厂、AI 自动剪辑、AI 视频、AI 编程

更新频率、答疑频率、课程数量、会员人数、退款规则等未确认信息，不得由 AI 自动补全。

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
