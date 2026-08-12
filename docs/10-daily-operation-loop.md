---
title: 每日自主运行循环
version: 0.2.0
updated_at: 2026-08-12
status: implemented_stage_1
---

# 每日自主运行循环

## 1. 产品约束

AI Auto Content 的目标是每天自动做一次可靠判断，不是每天必须发布内容。

完整目标循环：

```text
定时启动
→ 感知和收集新素材
→ 分析素材
→ 决定是否存在值得做的选题
→ 研究、写作和生成发布包
→ 人工最终上传或点击发布
→ 获取数据并复盘
→ 更新下一轮策略
→ 第二天继续
```

当证据、相关度或内容价值不足时，阶段 2 可以输出 `NO_PUBLISH`。阶段 1 只提供素材和确定性评分，不提前做选题决定。

## 2. 第一阶段运行流程

1. GitHub Actions 在北京时间 09:00 启动，也可手动启动。
2. 读取 `config/sources.yaml` 与 `config/scoring.yaml`。
3. 最多并发抓取 3 个来源；单次请求最多 15 秒，失败重试 2 次。
4. RSS 和 Atom 被映射到统一字段；第三方正文只截取最多 500 字纯文本摘要。
5. 清理 URL fragment、常见追踪参数和多余尾部斜杠。
6. 生成 URL SHA-256 和标准化标题加摘要的内容 SHA-256。
7. 对照跨天状态去重；同一批次也立即去重。
8. 按来源可信度、新鲜度和用户相关度进行确定性评分。
9. 用 Zod 校验后追加当天 JSONL，并更新去重状态。
10. 保存逐来源运行日志并生成当日 Markdown 日报。
11. 工作流只在指定输出目录有变化时提交。

## 3. 评分与接受条件

默认综合分：

```text
overall_score = relevance_score × 0.50
              + freshness_score × 0.25
              + evidence_score × 0.25
```

默认进入后续候选范围的条件：

- `relevance_score >= 50`
- `overall_score >= 60`

关键词组、权重、来源等级、新鲜度分段和阈值均位于 `config/scoring.yaml`。日报中的“为什么可能适合 AI 小白”只翻译命中的确定性标签，不生成未经验证的体验或结论。

## 4. 数据语义

- `data/materials/YYYY-MM-DD.jsonl`：当天首次发现且格式正确的唯一素材。
- `status=accepted`：达到阶段 1 的相关度和综合分门槛。
- `status=rejected`：未达门槛，保留规则化淘汰原因以便审计。
- `items_new`：本次新发现且达到门槛的素材数量。
- `items_duplicate`：URL 或内容指纹已出现的数量，不重复写入。
- `items_rejected`：本次首次发现但格式无效或未达门槛的数量。

保存低分唯一素材不会使其进入选题池；它的作用是防止跨天反复处理相同低价值内容，并让阈值行为可追溯。

## 5. 失败行为

- 单个来源失败：其他来源继续，运行状态为 `partial_success`，日报列出错误摘要。
- 所有来源失败：保存失败运行日志和日报后返回非零退出码，使 GitHub Actions 明确失败。
- 配置或去重状态损坏：拒绝静默继续，避免重复污染历史数据。
- 当天没有 `accepted` 素材：日报显示“今日没有足够高质量的新素材。”

## 6. 已启用来源与核验

核验日期：2026-08-12。核验方式为使用与采集器一致的 User-Agent、15 秒超时和重试策略真实请求，并确认 RSS / Atom 可解析。

| 来源 | 地址 | 覆盖方向 | 核验结果 |
|---|---|---|---|
| OpenAI News | `https://openai.com/news/rss.xml` | AI 官方产品更新 | HTTP 200，可解析 |
| Google AI Blog | `https://blog.google/innovation-and-ai/technology/ai/rss/` | 普通用户可理解的 AI 应用与更新 | HTTP 200，可解析 |
| GitHub AI and ML | `https://github.blog/ai-and-ml/feed/` | AI 开发工具 | HTTP 200，可解析 |
| n8n Blog | `https://blog.n8n.io/rss/` | AI 自动化 | HTTP 200，可解析 |
| Hugging Face Blog | `https://huggingface.co/blog/feed.xml` | AI 教程与开发生态 | HTTP 200，可解析 |
| Google DeepMind Blog | `https://deepmind.google/blog/rss.xml` | AI 官方研究信号 | HTTP 200，可解析 |
| HeyGen Product Updates | `https://heygen.noticeable.news/feed.rss` | AI 视频与内容工具 | HTTP 200，可解析 |

候选的 Anthropic、Microsoft AI、Make、HeyGen 主博客和 Descript 主博客订阅地址在核验时返回 404、410 或 403，因此没有启用，也没有尝试绕过访问控制。

## 7. 手动运行

```bash
npm run collect
npm run collect -- --date=2026-08-12
npm run collect -- --dry-run
npm run collect:fixture
```

在 GitHub 网页中进入 **Actions → Daily material collection → Run workflow** 可手动运行。机器人推送需要仓库 Workflow permissions 设为 **Read and write permissions**。

## 8. 本阶段明确不做

不做自动选题、文章或平台文案、配图、登录、发布、平台数据抓取、内容复盘、大模型调用、数据库、管理后台和社交平台爬虫。
