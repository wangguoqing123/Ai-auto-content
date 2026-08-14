---
title: Mac 本机采集、选题与研究调度器
version: 1.2.0
updated_at: 2026-08-14
status: implemented_not_installed
---

# Mac 本机采集、选题与研究调度器

## 运行逻辑

LaunchAgent 不是只在 08:00 触发一次，而是 `RunAtLoad=true`、`StartInterval=900`。每次启动只做一次轻量 due check：

```text
上海时间在 07:30—12:00
+ 今天未 success / partial_success
+ attempts < 2
→ 执行 morning

上海时间在 13:00—18:00
+ 今天 topic_selection 未 success
+ attempts < 2
→ 执行本机 Codex 每日选题

上海时间在 13:30—21:00
+ 今天 research_pack 未 success
+ attempts < 2
→ 读取 Topic；只抓指定 fact_source；执行研究与安全文本实验
```

调度检查先判断时间窗口：其他时间始终输出 `NOT_DUE`，不会因为已达到最大尝试次数而重复通知。窗口内当天完成输出 `ALREADY_COMPLETED`；活锁输出 `LOCK_HELD`。三者都返回 0，不访问平台。

`local:scheduler -- --once` 依次检查 Morning、Topic Selection、Research Pack。三个 manual 命令可在窗口外执行一次，但正式运行仍服从活锁、当天完成和最多 2 次尝试。状态分别保存在 `tasks.morning`、`tasks.topic_selection` 和 `tasks.research_pack`。

Research Topic 不存在时返回 `WAITING_FOR_TOPIC`、exit 0，不创建状态或增加失败次数；`NO_PUBLISH` 直接完成 `NO_TOPIC`；相同 hash 返回 `ALREADY_RESEARCHED`，不重复抓取、调用 Codex 或运行实验。

## Topic Selection 顺序

1. 获取 Topic 专用锁，读取外部状态并判断 13:00—18:00 窗口。
2. 同步 Runtime clone 的 `origin/main`，只接受合法 Browser/Topic pending commit。
3. 由选题管线读取和校验产品配置、Topic 配置、Schema、最近 72 小时素材与 30 天历史。
4. 无材料时直接 `NO_PUBLISH`，不解析 Codex 路径、不检查登录、不启动进程。
5. 有材料时使用显式 `TOPIC_CODEX_MODEL` 和解析后的绝对 `TOPIC_CODEX_BIN`，在隔离临时目录与只读 Sandbox 中最多调用 2 次。
6. 项目代码重新校验证据、Claim、产品上限、CTA、重复和六维评分，只得到一个母题或 `NO_PUBLISH`。
7. 只暂存 `data/topic-decisions/**`、`data/topic-runs/**`、`reports/topics/**`，敏感扫描后提交、单次 rebase 并 push；Codex 不执行 Git。
8. 更新 Topic 状态、发送必要通知，并在 `finally` 释放锁。failed 在窗口内最多再试一次。

## Morning 顺序

1. 读取外部状态并判断 due。
2. 原子创建锁目录；活 PID 阻止并发，超过 120 分钟且 PID 不存在才恢复 stale lock。
3. 同步独立 Runtime clone 的 `origin/main`；未推送数据 commit 优先恢复。任何 push 或 rebase 前先逐个验证 `origin/main..HEAD` 的提交标题、真实采集日期、变更白名单和该 commit 中现存文件的敏感内容；删除白名单文件允许通过，不可读或不合规时以 `invalid_staged_paths` 停止且不访问平台。仅 ahead 时先正常 push；ahead 与 behind 同时存在时验证后执行 `pull --rebase origin main`，rebase 后再次验证再 push；首次 push 与远端更新竞态时也只允许一次同样的有界恢复。
4. 若成功恢复的 pending commit 日期包含今天，读取外部状态并跳过当天重复采集；若只恢复历史日期，继续今天的任务。
5. 共享健康检查只以 Node >=20、npm、兼容 OpenCLI 1.x >=1.8.6、Chrome、daemon、Extension 和 Connectivity 阻断整条流水线。项目 adapter 与平台探测单独记录；X 登录和公众号公开搜索彼此独立探测，任何一方失败都不跳过另一方。
6. 并行运行 X 与微信公众号 Browser Pipeline。一个平台失败、另一个成功时整次为 `partial_success`，仍保存和同步成功数据；只有两者都失败时才为 `failed`。
7. 保存 Browser Materials、Run Log、公众号正文和 Browser 日报。公众号正文下载目录固定为 `data/weixin-articles/YYYY-MM-DD/<material_id>/`，同一素材重复运行稳定，同标题不同素材不会覆盖；产物必须经 `realpath` 验证位于 Runtime clone 的 `data/weixin-articles/**`，素材中的 `content_path` 只保存仓库相对 POSIX 路径，dry-run 为 `null`，命令摘要以 `[runtime-output]` 代替本机路径。
8. 公众号 Markdown 只改写顶部元数据中的“原文链接”：可追溯 URL 写入去参数后的 canonical URL，不可追溯临时 URL 删除；正文不做字符串替换。随后重新读取，从正文 URL 中只检查 `mp.weixin.qq.com` 与 `weixin.sogou.com` 的临时访问参数；外部域名的 `signature`、`sessionid` 等技术示例不误报。
9. 只暂存白名单路径，按文件类型扫描后创建数据 commit：Browser JSON/JSONL 必须真实解析并递归检查敏感键、`content_path` 和路径值；报告与公众号 Markdown 允许正常的 Authorization/Cookie/ct0 说明、代码路径示例和外部签名 URL，只拒绝当前真实 home、微信临时访问 URL 与明确的真实凭证赋值。
10. 再次验证完整 pending 范围；`git pull --rebase origin main` 后重验并正常 push。冲突 abort 并保留本地 commit，绝不 force、reset hard 或重新采集。
11. 原子更新外部状态，按需发送本机通知，并在 `finally` 中释放锁。

## Research Pack 顺序

1. 判断 13:30—21:00 窗口并检查 Topic Decision；Topic 未到时等待，不计失败。
2. 同步 Runtime clone，并先恢复合法 Browser、Topic 或 Research pending commit。
3. `NO_PUBLISH` 直接写 `NO_TOPIC`；`SELECT_TOPIC` 只读取原 fact_source IDs。
4. 每个 URL 与重定向重新解析 DNS 并拒绝非公网地址；完整清洗正文只写 Runtime clone 外的 0700/0600 本机缓存。
5. 共用结构化 Codex Runner，最多 4 次调用；quote 由代码精确验证，不做近义匹配。
6. 必要时运行 baseline 与 structured 各一次；八项验收由代码计算。
7. 只暂存 `data/research-packs/**`、`data/research-runs/**`、`reports/research/**`，标题固定 `chore(research): build evidence pack YYYY-MM-DD`。
8. 更新 Research 状态并发送只含决定、Topic 标题和是否完成实验的安全通知。

## 命令

```bash
npm run local:check
npm run local:morning -- --dry-run
npm run local:topic -- --dry-run
npm run local:research -- --dry-run
npm run local:scheduler -- --once
npm run local:scheduler -- --once --fixture --dry-run --now=2026-08-14T05:00:00.000Z
npm run local:install -- --dry-run
npm run local:uninstall -- --dry-run
npm run launchd:render
```

`local:morning -- --dry-run` 会访问真实平台；`local:research -- --dry-run` 只访问 Topic 指定官方来源，禁止 X、公众号和 Browser Collector。二者都不写状态、正式数据、报告或 Git。`--fixture --dry-run` 完全离线。

PR 合并后，用户确认 Chrome、Bridge、登录态和 Git 鉴权可用，再显式安装：

```bash
npm run opencli:install-adapters
export TOPIC_CODEX_MODEL="<explicit model>"
# TOPIC_CODEX_BIN 可选；留空时安装器从 PATH 解析绝对路径。
npm run local:install -- --install
```

安装器把同一个本机 Codex CLI 与显式模型传给 Topic 和 Research。直接手动运行时可用 `RESEARCH_CODEX_BIN` / `RESEARCH_CODEX_MODEL` 单独覆盖，但 plist 不保存两套配置。

卸载 LaunchAgent 但保留 Runtime、状态和日志：

```bash
npm run local:uninstall -- --uninstall
```

默认无参数和 `--dry-run` 都不会修改 `~/Library/LaunchAgents`。安装器把 Codex 的绝对路径和非敏感模型名传给 Runtime wrapper，但不会把 Token、Cookie、密码、PAT、API Key 或 Browser Session 写入 plist。

## 状态与通知

状态文件：`~/Library/Application Support/AiAutoContent/state/scheduler-state.json`。损坏状态不会被静默覆盖；旧状态缺少 Topic 或 Research task 时会安全补成未到期状态。

pending 恢复返回其中所有采集日期。恢复日期包含当天时，Morning 以当天外部状态确认结果并跳过平台，避免重复采集；仅包含历史日期时，仍继续执行当天共享健康检查和双平台 Pipeline。

文件类型感知扫描也用于所有 pending commit 的 commit 时点内容。JSON/JSONL 中名为 `authorization`、`cookie`、`ct0`、`auth_token`、`pass_ticket`、`exportkey`、`sessionid`、`xsec_token` 的非空真实值会被拒绝，`[redacted]`、`[not available]` 和普通错误描述允许；`content_path` 只能是 `null` 或 `data/weixin-articles/**` 下的仓库相对 POSIX 路径。Markdown 中出现裸词或 `/tmp/output`、`/home/example` 等文章示例不构成泄露证据。

通知标题固定为 `AI Auto Content`。Bridge 不可用、登录失效、blocked、部分成功、达到重试上限、Git 失败或写入失败时发送安全摘要；完整错误留在本机日志。第二次失败达到上限时发送一次 `Morning task reached maximum attempts`，之后的同日轮询静默返回；次日重新允许运行。通知失败不改变主任务结果。

## 退出码

| 退出码 | 含义 |
|---:|---|
| 0 | success、partial_success、not_due、waiting_for_topic、already_researched、already_completed、lock_held |
| 1 | 参数或程序错误 |
| 2 | Browser Pipeline 完全失败 |
| 3 | health check 失败 |
| 4 | login_required |
| 5 | blocked |
| 6 | git_sync_failed |
| 7 | invalid_staged_paths |

## 当前安装状态

本 PR 只提交代码和配置；没有 bootstrap、reload 或修改当前生产 LaunchAgent/Runtime clone，也没有执行 Browser Collector。Research 合并后仍需用户显式更新本机 Runtime 与 LaunchAgent。
