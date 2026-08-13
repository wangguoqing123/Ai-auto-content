---
title: 来源能力矩阵
version: 1.0.0
updated_at: 2026-08-13
status: live_checked
---

# 来源能力矩阵

## 运行时状态

| 运行时 | 状态 | 当前用途 | 是否每日运行 |
|---|---|---|---|
| Cloud Collector | `verified_live` | RSS / Atom + AIHOT v1 | 是；GitHub Actions 的唯一正式通道 |
| OpenCLI Browser Collector | `verified_live_manual` | 本机真实 Chrome 登录态下的受控采集 | 否；当前只手动运行 |
| Codex Browser | `exploration_only` | 页面探索、DOM 字段确认、登录诊断、适配器修复 | 否；不接入正式 Browser Pipeline |

下表的来源验证状态只使用 `verified_live`、`verified_fixture_only`、`login_required`、`manual_verification_required`、`temporarily_blocked`、`unsupported`。

| 来源 | 发现内容 | 正文 | 互动数据 | 评论 | 登录要求 | 当前状态 |
|---|---|---|---|---|---|---|
| RSS | 是；标题、链接、摘要、发布时间 | 仅有界摘要，不保存全文 | 否 | 否 | 无 | `verified_live` |
| AIHOT | 是；精选、热点、分类和搜索 | 否；v1 只有摘要与原始链接 | 否 | 否 | 无 | `verified_live` |
| X | 真实搜索，4 个查询返回 80 条 | 帖子正文 | 粉丝、点赞、转发、回复、引用、书签、浏览量已在线取得 | 否 | Chrome 中登录 X | `verified_live` |
| 小红书 | 2 个搜索真实返回 | 4 篇详情真实读取 | 点赞、收藏、评论已在线取得 | 2 组一级评论和楼中楼真实读取 | Chrome 中登录小红书 | `verified_live` |
| 公众号搜索 | 搜狗微信 2 个查询真实返回 20 条 | 否 | 不提供可验证互动数据 | 否 | Browser Bridge；本次未要求账号登录 | `verified_live` |
| 公众号正文 | 搜狗跳转解析后下载 5 篇 Markdown | 是 | 无 | 否 | Browser Bridge；部分文章未来可能要求人工验证 | `verified_live` |

上述浏览器来源的 `verified_live` 证据来自 2026-08-13 本机运行；运行时整体仍是 `verified_live_manual`，未配置无人值守调度。详见 `docs/14-opencli-live-capability-spike.md`。

Codex Browser 的历史 DOM 探索结果不作为本次 OpenCLI 证据；OpenCLI 结论来自 Browser Bridge 命令和最终 dry-run。Codex Browser 边界见 `docs/16-codex-browser-runtime-spike.md`。
