---
title: 云端与本机浏览器双通道采集运行时
version: 2.0.0
updated_at: 2026-08-13
status: cloud_scheduled_local_runtime_ready_for_install
cloud_status: production_scheduled
opencli_browser_status: verified_live
codex_browser_status: exploration_only
---

# 云端与本机浏览器双通道采集运行时

系统保留两个互不依赖的采集通道：

```text
Cloud Collector ── GitHub Actions 09:00 ── RSS / AIHOT ─┐
                                                        ├─ 统一素材契约
Local Browser ── 用户 Mac 08:00 目标窗口 ── X / 公众号 ─┘
```

## Cloud Collector

- 位置：GitHub-hosted Actions。
- 命令：`npm run collect:cloud`。
- 时间：UTC 01:00，即北京时间 09:00。
- 不读取 Chrome、Cookie 或本地登录态。
- 不调用本机 scheduler 或 OpenCLI Browser Collector。

## Local Browser Collector

- 位置：用户 Mac 的独立 Runtime clone。
- 活跃平台：`twitter`、`weixin`。
- 调度：LaunchAgent 每 900 秒运行一次 due check；`RunAtLoad=true`。
- 时间：`Asia/Shanghai` 07:30—12:00，目标时间 08:00，每天最多 2 次失败尝试。
- 默认 `auto_launch_chrome=false`，要求 Chrome 已打开且 Browser Bridge 已连接。
- X 登录、公众号公开搜索入口、daemon、Extension、Connectivity 任一失败时，不把 0 条写成空结果。

独立 clone 默认路径：

```text
~/Library/Application Support/AiAutoContent/runtime
```

状态、锁、外部配置和日志：

```text
~/Library/Application Support/AiAutoContent/state/
~/Library/Application Support/AiAutoContent/locks/
~/Library/Application Support/AiAutoContent/config/
~/Library/Logs/AiAutoContent/
```

## 数据和安全边界

Browser 正式运行只写：

- `data/browser-materials/**`
- `data/browser-runs/**`
- `data/weixin-articles/**`
- `reports/browser/**`

公众号下载结果先解析为绝对路径并执行 `realpath`，拒绝 `../`、符号链接逃逸、Runtime clone 外路径和非 Markdown 文件；统一素材只记录 `data/weixin-articles/.../*.md` 形式的仓库相对 POSIX 路径。dry-run 保持 `content_downloaded: true` 诊断，但 `content_path: null`。Markdown 顶部“原文链接”会替换为可追溯 canonical URL；只有临时参数的 URL 会被移除，正文中的普通 `signature` 单词不会被改写。

自动 commit 前会再次检查 staged paths，并扫描 URL 查询参数 `signature`、`pass_ticket`、`exportkey`、`sessionid`、`xsec_token`，以及 Cookie、Authorization、`ct0`、`auth_token`、本地用户目录与 `.DS_Store`。发现任何一项即拒绝提交；普通正文单词 `signature` 不会误报。

运行前优先同步 `origin/main`。已有未推送数据 commit 时：仅 ahead 正常 push；ahead/behind 同时存在时自动 `pull --rebase origin main` 后 push；首次 push 与远端更新竞态时只恢复一次。三种成功路径都跳过重新采集并返回 rebase 后的新 HEAD；冲突会执行 `git rebase --abort`，保留本地 commit，绝不 force push、reset hard、clean 或重新访问平台。

scheduled 触发仅在 07:30—12:00 窗口判断完成状态和尝试次数，窗口外始终 `NOT_DUE`。manual 触发可在窗口外运行，但仍服从锁、当天完成和最大尝试；manual dry-run 始终执行健康检查与 Browser dry-run，不写状态、正式数据或 Git。

## 失败语义

- `success`、`partial_success`：当天完成，不重复访问平台；部分成功保存并提交已有数据，同时发本机警告。
- `failed`：窗口内最多再尝试一次。
- `login_required`、`blocked`、`unavailable`：记录真实失败，不解释为零结果。
- `git_sync_failed`：保留本地数据 commit，下一次优先重试同步。
- `LOCK_HELD`：另一个进程仍在运行，当前检查安全退出。

完整安装、卸载、状态和退出码说明见 `docs/19-local-browser-scheduler.md`。旧平台验证只存在于历史审计文档，不属于本运行时。
