# AI Auto Content

面向 AI 小白与轻度进阶用户的每日自主内容系统。

项目以互联网产品经理「七天假」为内容主体。系统每天自动感知和整理素材，后续阶段再逐步接入自主选题、研究写作、发布包和数据复盘；人保留最终审核、上传与发布责任。

> 系统每天运行，但不要求每天发布。没有足够高质量的题目时，后续选题阶段必须允许输出 `NO_PUBLISH`。

## 当前阶段：混合素材采集 MVP

当前版本在 RSS 第一阶段上增加了 OpenCLI 浏览器采集 MVP：

```text
Cloud Collector（GitHub Actions）→ RSS / AIHOT / 公开来源
Browser Collector（用户本机）→ X / 小红书 / 公众号
→ 限流采集并隔离单源、单平台和单条失败
→ 标准化字段和规范 URL
→ URL 指纹 + 内容指纹跨天去重
→ 确定性评分与阈值判断
→ 保存 JSONL、运行日志和 Markdown 日报
→ 仅在输出有变化时提交
```

Browser Collector 必须使用真实 Chrome、Browser Bridge 和已有登录态，不能放到 GitHub-hosted runner。本阶段仍不调用大模型，不开发自动选题、写作、配图或发布。

## 快速开始

需要 Node.js 20 和 npm：

```bash
npm ci
npm run typecheck
npm test
npm run collect:fixture
```

真实采集：

```bash
npm run collect:cloud
npm run collect:cloud -- --date=2026-08-12
npm run collect:cloud -- --dry-run
npm run opencli:install-adapters
npm run spike:opencli
npm run collect:browser -- --dry-run
```

`--dry-run` 会真实执行 preflight/采集，但不会写入正式数据目录。`collect:fixture` 只使用本地 Fixture，不访问网络。当前实机 Browser Bridge 未连接，浏览器平台状态必须按 `docs/14-opencli-live-capability-spike.md` 处理，不能把 Fixture 成功描述成在线接通。

## 自动运行

`.github/workflows/daily-material-collection.yml` 支持：

- 每天 UTC 01:00，即北京时间 09:00 定时运行。
- 在 GitHub Actions 页面通过 **Run workflow** 手动运行。
- Node.js 20、`npm ci`、类型检查、测试和真实采集。
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
data/state/seen-materials.json      跨天 URL 与内容指纹
data/runs/run_*.json                每次运行及逐信源日志
reports/materials/YYYY-MM-DD.md     每日素材日报
```

首次运行时，7 天以前的 RSS 只写入指纹状态，不写入当天素材；发布时间未知的素材进入 `quarantined`。缺失互动字段保存为 `null`，不以 0 冒充真实数据。

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
