---
title: Mac 本机 Browser Collector 调度器
version: 1.0.0
updated_at: 2026-08-13
status: implemented_not_installed
---

# Mac 本机 Browser Collector 调度器

## 运行逻辑

LaunchAgent 不是只在 08:00 触发一次，而是 `RunAtLoad=true`、`StartInterval=900`。每次启动只做一次轻量 due check：

```text
上海时间在 07:30—12:00
+ 今天未 success / partial_success
+ attempts < 2
→ 执行 morning
```

其他时间输出 `NOT_DUE`；当天完成输出 `ALREADY_COMPLETED`；活锁输出 `LOCK_HELD`。三者都返回 0，不访问平台。

## Morning 顺序

1. 读取外部状态并判断 due。
2. 原子创建锁目录；活 PID 阻止并发，超过 120 分钟且 PID 不存在才恢复 stale lock。
3. 同步独立 Runtime clone 的 `origin/main`；未推送数据 commit 优先重试 push。
4. 检查 Node >=20、npm、兼容 OpenCLI 1.x >=1.8.6、项目 adapters、Chrome、daemon、Extension、Connectivity、X 登录和公众号公开搜索。
5. 只运行 X 与微信公众号 Browser Pipeline。
6. 保存 Browser Materials、Run Log、公众号正文和 Browser 日报。
7. 只暂存白名单路径，扫描敏感内容，创建数据 commit。
8. `git pull --rebase origin main` 后正常 push；冲突 abort，绝不 force。
9. 原子更新外部状态，按需发送本机通知，并在 `finally` 中释放锁。

## 命令

```bash
npm run local:check
npm run local:morning -- --dry-run
npm run local:scheduler -- --once
npm run local:scheduler -- --once --fixture --dry-run --now=2026-08-14T00:00:00.000Z
npm run local:install -- --dry-run
npm run local:uninstall -- --dry-run
npm run launchd:render
```

`local:morning -- --dry-run` 会访问真实平台，但不写正式数据或 Git。`--fixture --dry-run` 完全离线，供测试和 CI 使用。

PR 合并后，用户确认 Chrome、Bridge、登录态和 Git 鉴权可用，再显式安装：

```bash
npm run opencli:install-adapters
npm run local:install -- --install
```

卸载 LaunchAgent 但保留 Runtime、状态和日志：

```bash
npm run local:uninstall -- --uninstall
```

默认无参数和 `--dry-run` 都不会修改 `~/Library/LaunchAgents`。安装器不会把 Token、Cookie、密码、PAT 或 Browser Session 写入 plist。

## 状态与通知

状态文件：`~/Library/Application Support/AiAutoContent/state/scheduler-state.json`。损坏状态不会被静默覆盖。

通知标题固定为 `AI Auto Content`。Bridge 不可用、登录失效、blocked、部分成功、达到重试上限、Git 失败或写入失败时发送安全摘要；完整错误留在本机日志。通知失败不改变主任务结果。

## 退出码

| 退出码 | 含义 |
|---:|---|
| 0 | success、partial_success、not_due、already_completed、lock_held |
| 1 | 参数或程序错误 |
| 2 | Browser Pipeline 完全失败 |
| 3 | health check 失败 |
| 4 | login_required |
| 5 | blocked |
| 6 | git_sync_failed |
| 7 | invalid_staged_paths |

## 当前安装状态

本 PR 只提交代码、模板和 dry-run 安装器；没有 bootstrap 生产 LaunchAgent，也没有执行正式平台采集。生产安装由用户在合并后完成。
