---
title: 来源能力矩阵
version: 1.1.0
updated_at: 2026-08-13
status: live_checked
---

# 来源能力矩阵

## 运行时状态

| 运行时 | 状态 | 当前用途 | 是否每日运行 |
|---|---|---|---|
| Cloud Collector | `verified_live` | RSS / Atom + AIHOT v1 | 是；GitHub Actions 的唯一正式通道 |
| OpenCLI Browser Collector | `verified_live` | X 与微信公众号；待本 PR 合并后安装本机调度 | 否；尚未安装生产 LaunchAgent |
| Codex Browser | `exploration_only` | 页面探索、DOM 字段确认、登录诊断、适配器修复 | 否；不接入正式 Browser Pipeline |

下表的来源验证状态只使用 `verified_live`、`verified_fixture_only`、`login_required`、`manual_verification_required`、`temporarily_blocked`、`unsupported`。

| 来源 | 发现内容 | 正文 | 互动数据 | 评论 | 登录要求 | 当前状态 |
|---|---|---|---|---|---|---|
| RSS | 是；标题、链接、摘要、发布时间 | 仅有界摘要，不保存全文 | 否 | 否 | 无 | `verified_live` |
| AIHOT | 是；精选、热点、分类和搜索 | 否；v1 只有摘要与原始链接 | 否 | 否 | 无 | `verified_live` |
| X | 最新真实搜索为 80 raw / 78 unique / 2 duplicate | 帖子正文 | 粉丝、点赞、转发、回复、引用、书签、浏览量已在线取得；富搜索失败可回退基础字段 | 否 | Chrome 中登录 X | `verified_live` |
| 公众号搜索 | 最新真实搜索为 20 raw / 20 unique / 0 duplicate | 否 | 不提供可验证互动数据 | 否 | Browser Bridge；本次未要求账号登录 | `verified_live` |
| 公众号正文 | 最新一次 5 个下载命令退出成功，4 篇通过最终正文解析 | 是 | 无 | 否 | Browser Bridge；部分文章可能业务失败或要求人工验证 | `verified_live` |

上述浏览器来源的 `verified_live` 证据来自 2026-08-13 本机运行；生产 LaunchAgent 尚未安装。首次 Bridge 未连接记录保留在 `docs/14-opencli-live-capability-spike.md`，后续成功接通与去重修正见 `docs/17-opencli-browser-live-validation.md`。已退出平台的旧验证事实只保留在历史审计文档中，不属于当前能力矩阵。

Codex Browser 的历史 DOM 探索结果不作为本次 OpenCLI 证据；OpenCLI 结论来自 Browser Bridge 命令和最终 dry-run。Codex Browser 边界见 `docs/16-codex-browser-runtime-spike.md`。
