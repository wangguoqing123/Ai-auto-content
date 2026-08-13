---
title: OpenCLI 浏览器采集成功验证与第二轮修正报告
version: 1.1.0
updated_at: 2026-08-13
status: verified_live_manual
---

# OpenCLI 浏览器采集成功验证与第二轮修正报告

OpenCLI Browser Collector 已于 2026-08-13 在用户本机真实 Chrome Profile 和现有登录态下接通。X、小红书、微信公众号搜索和正文下载均取得真实返回。这里的 `verified_live_manual` 只表示本机手动链路已真实验证，不表示适合 GitHub-hosted Actions 或无人值守定时；Cloud Collector 仍是唯一正式每日运行通道，Codex Browser 仍为 `exploration_only`。

`docs/14-opencli-live-capability-spike.md` 保留 2026-08-12 Browser Bridge 未连接的首次失败记录，本文件记录后续成功接通和本轮审查修正，两者不能互相覆盖。

## 执行环境

| 项目 | 实际值 |
|---|---|
| 验证日期 | 2026-08-13，Asia/Shanghai |
| PR 基准提交 | `0c0e889a534f317279f1e240c6475faaa2bfe5d2` |
| Node.js | v22.22.2 |
| OpenCLI | 1.8.6 |
| OpenCLI daemon | 端口 19825，版本 1.8.6 |
| Browser Bridge | 已连接，扩展版本 1.0.22 |
| Chrome Profile | 用户当前 Profile；本地标识不写入仓库 |

Bridge 扩展来自 OpenCLI v1.8.6 官方 Release，解压前校验的 SHA-256 为 `9d2e3d053948beab5d97124aa79b1532d2122e33e461eca56cac113afd33207a`。

## 执行边界

- 所有平台命令均为只读搜索、详情、评论读取、URL 跳转解析或正文下载。
- 没有发布、点赞、评论、关注、收藏或发送消息。
- 没有导出 Cookie、密码、请求头或登录凭证。
- 出现登录墙、验证码、安全限制或 Browser Bridge 不可用时停止，不绕过，也不触发 X fallback 重试。
- `--dry-run` 真实访问平台，但不写 `data/browser-*`；公众号临时正文目录在运行结束后删除，返回素材将 `content_path` 清空，并用 `content_downloaded: true` 记录当次正文曾成功下载。
- GitHub PR CI 只运行 Fixture、类型检查和测试，不访问真实平台。

## 第一轮真实接通事实

### X / Twitter

项目内 `twitter search-rich` 在真实 Chrome 登录态下取得：`id/author/author_followers/text/created_at/likes/retweets/replies/quotes/bookmarks/views/url/media`。首轮完整 dry-run 的 4 个 X 查询产生 80 个 raw 行，当时尚未报告跨查询唯一数。

本轮增加内建 `twitter search` fallback。只有富搜索命令失败、适配器缺失、GraphQL Operation 变化或富 payload 解析失败时才调用；登录失效、验证码、风控或 Bridge 不可用时不 fallback。fallback 成功的素材标记为 `opencli-twitter-basic`，平台状态为 `partial_success`，富搜索独有字段保持 `null`。

### 小红书

真实链路已完成搜索、4 篇详情和 2 组评论读取。搜索返回的完整 URL 仍作为当次 detail/comments 的 access URL，但本轮起正式素材、JSONL、运行摘要和报告只保留：

```text
https://www.xiaohongshu.com/explore/<note-id>
```

`material_id` 使用 note ID，因此不同 `xsec_token` 或不同查询命中同一笔记时只产生一个唯一素材，并合并全部查询来源。首轮完整 dry-run 产生 4 个 raw 精选行，当时尚未报告唯一数。

### 微信公众号搜索和正文

真实链路已确认：搜狗微信搜索结果先经 `weixin resolve-article-url` 跟随正常跳转，再由 `weixin download` 下载 Markdown。首轮搜索产生 20 个 raw 发现行，其中 5 篇正文下载成功；当时尚未报告唯一数。

本轮正式素材不保存搜狗跳转参数、微信临时 signature 或 tracking 参数。`/s/<slug>` 使用稳定 path，`/s?...` 只保留 `__biz/mid/idx/sn`；不足以形成稳定 URL 身份时，优先使用公众号名称、标题和精确发布时间的规范化 SHA-256。正文失败时仍保留已发现、已规范化的搜索素材。

## 第二轮代码修正

- `material_id` 优先使用 `source_platform + source_item_id`，否则使用平台 canonical URL，不再以临时 access URL 为主身份。
- 统一 `mergeUnifiedMaterial` 和 `deduplicateUnifiedMaterials`，保留全部 `query_id/query_text`、最小排名、更完整正文、最新采集时间和同次运行最大非空互动数。
- Browser Pipeline 和每个平台同时报告 `raw_materials_count/materials_count/duplicate_materials_count`。
- 同日持久化从最后一条覆盖改为统一合并；重复运行可刷新互动数而不丢失先前查询来源，JSONL 按 `material_id` 稳定排序并在写入前重新校验 schema。
- 公众号正文相对时间使用当次 `now` 推断，不再以 Unix epoch 为基准；非法日期和时间返回 `unknown`，不会覆盖搜索阶段的有效时间。
- dry-run 清理临时正文后不再返回失效路径。

## 第一轮数量审计

第一轮最终 dry-run `browser_20260813032321` 报告的 104 是 raw 行数之和：X 80 + 小红书 4 + 公众号 20。上一轮临时证据目录已经清理，旧版本输出又没有唯一数和重复数，因此不能离线补写旧 `unique/duplicate`；本报告不会把 104 描述为 104 条唯一素材。

## 修正后最终真实 dry-run

完成全部代码和离线测试后，只执行一次：

```bash
npm run opencli:install-adapters
npm run collect:browser -- --dry-run
```

最终只执行了一次真实采集，结果如下：

| 平台 | 状态 | 成功命令 | raw | unique | duplicate | 正文成功 |
|---|---|---:|---:|---:|---:|---:|
| X / Twitter | `success` | 4 / 4 | 80 | 78 | 2 | 不适用 |
| 小红书 | `success` | 8 / 8 | 4 | 4 | 0 | 不适用 |
| 微信公众号 | `partial_success` | 12 / 12 | 20 | 20 | 0 | 4 |
| 总计 | `partial_success` | 24 / 24 | 104 | 102 | 2 | 4 |

- run ID：`browser_20260813042041`。
- preflight：`success`。
- X 全部使用 `opencli-twitter-rich`，本次没有触发 basic fallback；两个跨查询重复 Tweet 合并后保留全部查询来源。
- 小红书 4 条最终素材全部使用无 `xsec_token` 的 canonical URL。
- 微信 5 次 download 命令均以进程状态成功返回，其中 4 条最终素材通过正文解析并标记 `content_downloaded: true`。另 1 次 exit 0 的正文处理没有形成通过业务解析和 schema 校验的已下载素材，因此 Collector 正确标记 `partial_success`，对应搜索素材继续保留。该次旧诊断没有把捕获的解析异常写入 `error`；本轮随后补上错误传播，但遵守“一次有界最终 dry-run”的要求，没有再次访问真实平台。
- dry-run 清理后所有 `content_path` 均为 `null`，没有输出已删除文件路径。
- 运行结果中未发现 `xsec_token`、微信临时 signature、`pass_ticket` 或带参数的搜狗跳转 URL。

## 真实运行后的离线正确性补丁

以下修正在 `browser_20260813042041` 之后仅通过 Fixture、单元测试和端到端持久化测试完成，没有再次访问 X、小红书、搜狗微信或公众号正文，也没有重新执行 Browser dry-run。上面的真实运行统计保持不变。

- 公众号 discovery identity 不再依赖动态推断到分钟和秒的时间。`inferred` 时间只使用 Asia/Shanghai 日历日期，标题与摘要经过 NFKC、空白合并、trim 和 lowercase 规范化。
- 公众号素材在搜索阶段生成主 `source_item_id/material_id`；resolve URL、正文下载、公众号名称和精确时间只补充 canonical URL、元数据与 `identity_aliases`，不更换主身份。
- 只有搜狗标题和摘要、尚未取得可追溯微信原文 URL 的素材标记为 `source_access_status: unresolved`，进入 `quarantined`，并包含 `unresolved_source_url`；已解析原文但正文失败的搜索素材仍为 `resolved` 且保留。
- X basic fallback 现在继承查询配置中的 `product=top/live`，同时保留 limit、语言、时间范围和排除回复/转发的 operator。
- 平台完全失败时采用固定终端优先级：`blocked > login_required > unavailable > command_failed`；已有真实素材时仍为 `partial_success`。
- 跨两次运行的持久化测试验证：首次 unresolved 搜索素材与第二次下载成功素材保持同一 `material_id`，最终 JSONL 只有一行，并正确升级原文 URL、作者、精确时间、正文状态与两次查询来源。

这些结论是离线正确性验证，不是新的真实平台运行结果。

## 验证层级与运行建议

| 通道 | 当前状态 | 用途 |
|---|---|---|
| Cloud Collector | `verified_live` | GitHub Actions 正式每日采集 |
| OpenCLI Browser Collector | `verified_live_manual` | 用户本机手动 dry-run 和受控采集 |
| Codex Browser | `exploration_only` | 页面探索、登录诊断和适配器排查 |

当前不增加 `launchd`，也不把 Browser Collector 放入 GitHub Actions。OpenCLI 或平台适配器升级后仍需重新验证，不能沿用本报告推断新版本兼容。
