---
title: 来源能力矩阵
version: 1.0.0
updated_at: 2026-08-12
status: live_checked
---

# 来源能力矩阵

## 运行时状态

| 运行时 | 状态 | 当前用途 | 是否每日运行 |
|---|---|---|---|
| Cloud Collector | `verified_live` | RSS / Atom + AIHOT v1 | 是；GitHub Actions 的唯一正式通道 |
| OpenCLI Browser Collector | `experimental_manual_only` | 本地手动 preflight、Fixture 和待验证的平台采集 | 否 |
| Codex Browser | `exploration_only` | 页面探索、DOM 字段确认、登录诊断、适配器修复 | 否；不接入正式 Browser Pipeline |

下表的来源验证状态只使用 `verified_live`、`verified_fixture_only`、`login_required`、`manual_verification_required`、`temporarily_blocked`、`unsupported`。

| 来源 | 发现内容 | 正文 | 互动数据 | 评论 | 登录要求 | 当前状态 |
|---|---|---|---|---|---|---|
| RSS | 是；标题、链接、摘要、发布时间 | 仅有界摘要，不保存全文 | 否 | 否 | 无 | `verified_live` |
| AIHOT | 是；精选、热点、分类和搜索 | 否；v1 只有摘要与原始链接 | 否 | 否 | 无 | `verified_live` |
| X | OpenCLI 搜索命令与富字段适配器已注册 | 帖子正文 | 目标字段已实现，但本机未完成在线取数 | 否 | Chrome 中登录 X | `manual_verification_required` |
| 小红书 | 搜索 Fixture 与命令 schema 已验证 | 详情 Fixture 与命令 schema 已验证 | 点赞、收藏、评论 Fixture 已验证 | 一级评论与楼中楼 Fixture 已验证 | Chrome 中登录小红书 | `manual_verification_required` |
| 公众号搜索 | 搜狗微信搜索 Fixture 与命令 schema 已验证 | 否 | 无可验证互动数据 | 否 | 不要求账号，但要求 Browser Bridge | `manual_verification_required` |
| 公众号正文 | 通过文章 URL 下载 Markdown 的 Fixture 与命令 schema 已验证 | 是，待本机在线验证 | 无 | 否 | Browser Bridge；部分文章会要求人工环境验证 | `manual_verification_required` |

`manual_verification_required` 的直接原因不是 Fixture 失败，而是 2026-08-12 实机 `opencli doctor` 返回 Browser Bridge 扩展未连接，因此登录态和在线返回字段均无法核实。详见 `docs/14-opencli-live-capability-spike.md`。

Codex Browser 已真实读取小红书搜索、详情、评论和搜狗微信搜索 DOM，但这只证明页面探索能力，不证明 OpenCLI 生产链路已接通。其真实边界见 `docs/16-codex-browser-runtime-spike.md`。
