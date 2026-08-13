---
title: OpenCLI 浏览器采集真实能力报告
version: 2.0.0
updated_at: 2026-08-13
status: verified_live_manual
---

# OpenCLI 浏览器采集真实能力报告

OpenCLI Browser Collector 已于 2026-08-13 在用户本机真实 Chrome Profile 和现有登录态下完成在线验证。X、小红书、微信公众号搜索和正文下载均取得真实返回，并完成一次不写正式数据的可重复 dry-run。

这里的 `verified_live_manual` 只表示本机手动链路已真实接通，不表示它适合 GitHub-hosted Actions 或无人值守定时。Cloud Collector 仍是唯一正式每日运行通道；Codex Browser 仍是 `exploration_only`。

## 执行环境

| 项目 | 实际值 |
|---|---|
| 验证时间 | 2026-08-13，Asia/Shanghai |
| 基准提交 | `be0df7fefd200079967a5709ac9c094c1627ad91` |
| Node.js | v22.22.2 |
| OpenCLI | 1.8.6 |
| OpenCLI daemon | 端口 19825，版本 1.8.6 |
| Browser Bridge | 已连接，扩展版本 1.0.22 |
| Chrome Profile | 用户当前 Profile；本地标识不写入仓库 |
| Connectivity | 0.5 秒通过 |

Bridge 扩展来自 OpenCLI v1.8.6 官方 Release，解压前校验的 SHA-256 为 `9d2e3d053948beab5d97124aa79b1532d2122e33e461eca56cac113afd33207a`。

## 执行边界

- 所有平台命令均为只读搜索、详情、评论读取、URL 跳转解析或正文下载。
- 没有发布、点赞、评论、关注、收藏或发送消息。
- 没有导出 Cookie、密码、请求头或登录凭证。
- 没有遇到验证码、登录墙、频率限制或安全验证；若未来遇到，Collector 仍会停止对应平台，不绕过。
- `--dry-run` 真实访问平台，但公众号正文只写临时目录，运行结束后自动删除，不写 `data/browser-*` 正式目录。

## 真实探针结果

### X / Twitter

项目内 `twitter search-rich` 在当前 Chrome 登录态下真实返回 3 条探针结果。实际取得字段：

```text
id
author
author_followers
text
created_at
likes
retweets
replies
quotes
bookmarks
views
url
has_media
media_urls
media_posters
```

首次完整 dry-run 暴露出自定义适配器从 X 客户端脚本动态扫描公共 Web bearer token 不稳定。修复后改为优先复用当前 OpenCLI 安装包集中维护的公共 Web token，页面扫描仅作后备；用户身份仍由 Chrome 中的 `ct0` 登录 Cookie 判断，Cookie 不离开浏览器环境。

修复后同一失败查询重新执行成功，随后完整 dry-run 的 4 个 X 查询全部成功，返回 80 条材料。该次运行没有缺失目标富互动字段。

### 小红书

真实探针按顺序完成：

1. `xiaohongshu search` 返回 3 条结果，字段包括 `rank/author/likes/title/url/published_at`。
2. 搜索 URL 均保留详情和评论所需的 `xsec_token`。
3. `xiaohongshu note` 取得 `title/author/content/likes/collects/comments/tags`。
4. `xiaohongshu comments --with-replies true` 取得顶层评论与楼中楼的 `rank/author/userId/profileUrl/text/likes/time/is_reply/reply_to`。

`--limit` 限制顶层评论数量；启用楼中楼后总行数可能超过该值。完整 dry-run 执行 2 个搜索、4 篇详情和 2 组评论，共产出 4 条精选材料。

当前确认缺失或不提供的统一字段为：`author_followers/views/shares/reposts/quotes/bookmarks`。搜索日期继续标记 `published_at_quality: inferred`，不冒充平台官方精确时间。

### 微信公众号搜索和正文

`weixin search` 真实返回 `rank/page/title/url/summary/publish_time`，但实际 URL 是 `weixin.sogou.com/link?...`，不是原 Collector 预期的直接 `mp.weixin.qq.com` URL。

本次增加只读 `weixin resolve-article-url` 适配器：

```text
搜狗搜索结果 URL
→ 在 Browser Bridge 中打开并跟随正常跳转
→ 检查验证码/安全验证
→ 返回 mp.weixin.qq.com/s?... URL
→ weixin download 导出 Markdown
```

真实正文下载取得 `title/author/publish_time/status/size/saved`。Parser 同步支持搜索返回的相对时间（如“2小时前”，标记 `inferred`）和正文返回的中文绝对时间（如“2026年8月13日 09:01”，标记 `exact`），并拒绝 OpenCLI 退出码为 0 但业务字段为 `status: invalid URL` 的假成功。

完整 dry-run 搜索 2 个关键词、返回 20 条发现结果，成功解析并下载其中 5 篇正文。微信公众号没有可验证的阅读、点赞、评论、分享、转发、引用、书签或收藏字段；这些值保持 `null`，`viral_confidence` 保持 `unverified`。

## 完整 dry-run 验收

修复后的最终命令：

```bash
npm run opencli:install-adapters
npm run collect:browser -- --dry-run
```

最终运行摘要：

| 项目 | 结果 |
|---|---:|
| run_id | `browser_20260813032321` |
| preflight | `success` |
| 总体状态 | `success` |
| 成功命令 | 24 / 24 |
| X | 4 个查询，80 条材料 |
| 小红书 | 8 个命令，4 条材料 |
| 公众号 | 12 个命令，20 条材料，其中 5 篇正文 |
| 总材料数 | 104 |

## 验证层级与运行建议

| 通道 | 当前状态 | 用途 |
|---|---|---|
| Cloud Collector | `verified_live` | GitHub Actions 正式每日采集 |
| OpenCLI Browser Collector | `verified_live_manual` | 用户本机手动 dry-run 和受控采集 |
| Codex Browser | `exploration_only` | 页面探索、登录诊断和适配器排查 |

当前不增加 `launchd`，也不把 Browser Collector 放入 GitHub Actions。OpenCLI 或其 Twitter 内部适配器升级后，应重新运行安装命令、平台小探针和完整 dry-run，不能沿用本报告推断新版本仍兼容。
