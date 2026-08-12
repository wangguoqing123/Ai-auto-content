# AI Auto Content

面向 AI 小白与轻度进阶用户的每日自主内容系统。

项目以互联网产品经理「七天假」为内容主体。系统每天自动感知和整理素材，后续阶段再逐步接入自主选题、研究写作、发布包和数据复盘；人保留最终审核、上传与发布责任。

> 系统每天运行，但不要求每天发布。没有足够高质量的题目时，后续选题阶段必须允许输出 `NO_PUBLISH`。

## 当前阶段：每日素材采集器

当前版本为 `v0.2.0`，只实现第一阶段：

```text
GitHub Actions 定时启动
→ 读取 RSS / Atom 信源配置
→ 限流抓取并隔离单源失败
→ 标准化字段和规范 URL
→ URL 指纹 + 内容指纹跨天去重
→ 确定性评分与阈值判断
→ 保存 JSONL、运行日志和 Markdown 日报
→ 仅在输出有变化时提交
```

本阶段不调用大模型，不开发自动选题、写作、配图、发布或平台数据分析。

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
npm run collect
npm run collect -- --date=2026-08-12
npm run collect -- --dry-run
```

`--dry-run` 会读取现有去重状态，但不会写入正式数据目录。`collect:fixture` 只使用本地测试订阅，不访问网络。

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
data/materials/YYYY-MM-DD.jsonl     当天首次发现的唯一素材
data/state/seen-materials.json      跨天 URL 与内容指纹
data/runs/run_*.json                每次运行及逐信源日志
reports/materials/YYYY-MM-DD.md     每日素材日报
```

每条格式正确且首次发现的素材都会保存，并通过 `status` 区分 `accepted` 与 `rejected`。运行日志中的 `items_new` 只统计达到阈值的有效素材，低分素材保留用于审计规则，不会自动进入后续选题池。

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

发生冲突时，真实性与合规规则、人物事实库和产品知识库优先。资料不足时必须标记 `UNKNOWN`，不得自行补全。

## 明确不做

- 为了日更制造垃圾内容。
- 单纯搬运 AI 新闻。
- 编造个人经历、测试、用户案例、收入或数据。
- 通过伪造生活细节制造“真人感”。
- 以规避平台审核、检测或标注要求为目标。
- 在未经确认时承诺课程权益、更新频率或学习结果。
- 在当前阶段接入数据库、浏览器爬虫、大模型或自动发布。
