---
title: 云端与浏览器双通道采集运行时
version: 1.0.0
updated_at: 2026-08-12
status: mvp_implemented
---

# 云端与浏览器双通道采集运行时

## 运行边界

系统分为两个独立运行通道：

```text
Cloud Collector ── RSS / AIHOT / 公开无登录来源 ──┐
                                                   ├─ 统一素材字段与指纹 ── 后续选题器
Browser Collector ─ X / 小红书 / 公众号 ──────────┘
```

### Cloud Collector

- 运行位置：GitHub-hosted Actions。
- 当前命令：`npm run collect:cloud`。
- 职责：RSS、AIHOT 及未来明确无需登录的公开新闻接口。
- 不读取 Chrome、Cookie 或本地登录态。
- 每日 Workflow 只调用 Cloud Collector。

### Browser Collector

- 运行位置：用户自己的 Mac，或一台长期在线且拥有真实 Chrome Profile 的专用机器。
- 当前命令：`npm run collect:browser -- --dry-run`。
- 职责：X GraphQL 搜索、小红书搜索/详情/评论、搜狗微信搜索和公众号正文下载。
- 不得运行在 `ubuntu-latest`、`windows-latest`、`macos-latest` 等 GitHub 托管临时机器上。

## Chrome、扩展与登录要求

Browser Collector 启动时首先真实执行 `opencli doctor`。只有 daemon、Browser Bridge Extension 和 Connectivity 都正常时才进入平台命令。

- Chrome 必须正在运行。
- Browser Bridge 版本需要与当前 OpenCLI 兼容。
- 用户需要提前在普通 Chrome 中登录 X 和小红书。
- 公众号公开搜索不要求公众号账号，但搜狗或微信可能弹出人工验证。
- 不导出 Cookie，不把 Cookie、请求头或 Session 写入项目。
- 不自动完成验证码或安全验证。

## 失败与离线处理

- 本地机器离线、Chrome 关闭或 Bridge 未连接：Browser Collector 记录 `unavailable`，Cloud Collector 继续运行。
- 单个平台失败：其他平台继续，最终状态为 `partial_success`。
- 登录失效：记录 `login_required` 并停止该平台。
- 安全限制、验证码或频率限制：记录 `blocked` 并停止该平台本轮所有后续请求。
- 命令超时、JSON 解析失败和取消运行都有独立状态；超时进程会被终止。

## 数据合并

- 两个通道使用统一的素材核心字段，包括 `source_platform`、`source_kind`、`collector`、`query_id`、发布时间质量、互动字段质量、使用方式和病毒性置信度。
- Cloud Collector 继续写 `data/materials/YYYY-MM-DD.jsonl`。
- Browser Collector 非 dry-run 时写 `data/browser-materials/YYYY-MM-DD.jsonl` 和 `data/browser-runs/`；公众号正文写入 `data/weixin-articles/`。
- 后续消费端按 `material_id` 合并；URL 和内容指纹继续用于跨来源去重。
- 互动缺失统一为 `null`。搜索排名只保存在来源记录语义中，不映射成互动分数。

## 预算与轮换

- 每个平台每次最多 4 个关键词，不每天跑完所有词。
- X 每个查询最多 20 条。
- 小红书每个关键词最多 10 条、最多 3 篇详情；全局最多 3 篇评论，每篇最多 10 条一级评论。
- 公众号每个关键词只查第 1 页、最多 10 条；全局最多下载 5 篇正文。
- `config/platform-queries.yaml` 负责启用、优先级、轮换和预算。

## 未来定时方式

本 PR 不配置 Browser Collector 的正式定时任务。待在线能力完成验证后，可在本机使用 macOS `launchd` 或专用机器的系统调度器运行，并满足：

1. 机器长期在线且 Chrome Profile 稳定。
2. 先运行 preflight，失败时不继续平台请求。
3. 与 Cloud Collector 使用不同运行日志和故障告警。
4. 不把浏览器任务迁移到 GitHub-hosted runner。
