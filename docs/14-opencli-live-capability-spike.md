---
title: OpenCLI 实时能力验证报告
version: 1.0.0
updated_at: 2026-08-12
status: live_checked_with_manual_blocker
---

# OpenCLI 实时能力验证报告

## 执行环境

| 项目 | 实际值 |
|---|---|
| 综合 spike 完成时间 | 2026-08-12 15:31:35 Asia/Shanghai |
| 操作系统 | macOS 15.7.5（Build 24G624） |
| Node.js | v22.22.2 |
| npm | 10.9.7 |
| OpenCLI | 1.8.6；执行时与 `npm view @jackwener/opencli version` 一致 |
| OpenCLI daemon | 正常，端口 19825，版本 1.8.6 |
| Chrome | 正在运行；本机进程显示 Chrome 150.0.7871.187 |
| Browser Bridge | 未连接；重启 daemon 后复检结果不变 |
| X 登录状态 | 无法检查，Bridge 在登录态检查前阻断 |
| 小红书登录状态 | 无法检查，Bridge 在登录态检查前阻断 |
| 搜狗微信状态 | 无法检查，Bridge 在页面访问前阻断 |

## 安装与注册结果

- `qiaomu-opencli-usage`、`qiaomu-opencli-browser`、`qiaomu-opencli-explorer`、`qiaomu-opencli-autofix`、`qiaomu-smart-search` 已在当前会话可读取，不需要新会话。
- AIHOT Skill 1.4.1 已在当前会话可读取。
- `npm install -g @jackwener/opencli@latest` 成功，实际版本 1.8.6。
- 项目内只读适配器 `twitter/search-rich` 已安装到 OpenCLI 用户适配器目录；实时 help 已声明 `author_followers/retweets/replies/quotes/bookmarks/views` 等字段。该适配器尚未完成在线数据验证。

## 执行过的只读命令

预检与实时 schema：

```text
opencli --version
opencli doctor
opencli daemon restart
opencli list -f yaml
opencli twitter -h
opencli twitter search -h
opencli twitter search-rich -h
opencli xiaohongshu -h
opencli xiaohongshu search -h
opencli xiaohongshu note -h
opencli xiaohongshu comments -h
opencli weixin -h
opencli weixin search -h
opencli weixin download -h
npm run collect:browser -- --dry-run
npm run spike:opencli
```

在首次定位环境问题时执行过一次有界 X 中文搜索探测；未获得可解析结果。修复 preflight 对 `doctor` 的退出码识别后，两个正式入口都会先停止，不再向三个浏览器平台发请求。所有命令均为只读，没有点赞、评论、关注、发布或导出 Cookie。

## 实时结果

### Browser Collector 总体

- `npm run collect:browser -- --dry-run`：命令成功结束，不写正式数据；preflight 用时 8,408 ms。
- `npm run spike:opencli`：Browser preflight 用时 9,045 ms。
- 两次均得到：daemon `OK`、Extension `MISSING`、Connectivity `FAIL`。
- 三个平台真实返回条数均为 0。这里的 0 表示没有完成采集，不表示平台搜索结果为空。
- 当前能力状态统一为 `manual_verification_required`，不适合无人值守。

### X / Twitter

- 实际在线数据：未获得。
- 登录状态：未核实。
- 内建 `twitter search` 的实时 schema 声明：`id`、`author`、`bio`、`text`、`created_at`、`likes`、`views`、`url`、媒体、卡片、引用帖。
- 因内建 schema 缺少富互动字段，已增加项目内 `search-rich`；它的实时 schema 声明：`id`、`author`、`author_followers`、`text`、`created_at`、`likes`、`retweets`、`replies`、`quotes`、`bookmarks`、`views`、`url`、媒体。
- 真实获得字段：无。
- 当前缺失字段：全部目标字段；适配器注册成功不等于在线取数成功。
- 状态：`manual_verification_required`。

### 小红书

- 实际在线数据：未获得。
- 登录状态：未核实。
- 实时 schema 确认搜索返回 `rank/title/author/likes/published_at/url`，详情返回字段值表，评论返回 `author/text/likes/time/is_reply/reply_to`。
- 搜索 URL 的 `xsec_token` 在配置和解析器中强制保留；裸 note ID 不会被采集器接受。
- 搜索结果中的日期来自笔记 ID 推断，统一标记 `published_at_quality: inferred`，不能写成官方发布时间。
- 真实获得字段：无。
- 当前缺失字段：标题、作者、正文、点赞、收藏、评论、标签及评论详情的在线实值。
- 状态：`manual_verification_required`。

### 微信公众号

- 实际在线搜索和正文：未获得。
- 实时 schema 确认搜索字段为 `rank/page/title/url/summary/publish_time`，下载字段为 `title/author/publish_time/status/size/saved`。
- 公众号搜索没有阅读、在看、转发、收藏数据；统一保存为 `engagement: null`、`viral_confidence: unverified`、`usage_mode: structure_inspiration`。
- 搜狗排名只作为发现信号，不作为爆款证据。
- 真实获得字段：无。
- 当前缺失字段：搜索和正文的全部在线实值；互动指标属于 `unsupported`，不是待补 0。
- 状态：`manual_verification_required`。

### AIHOT

所有请求只使用 `https://aihot.virxact.com/api/v1/*`，均为匿名只读请求：

| 验证项 | HTTP | 条数 | 耗时 | 实际字段 |
|---|---:|---:|---:|---|
| 过去 24 小时精选 | 200 | 5 | 238 ms | `id/title/originalTitle/summary/source/links/publishedAt/discoveredAt/category/score/selected/attribution` |
| 当前热点 | 200 | 10 | 115 ms | `rank/id/title/source/links/sourceCount/signalCount/sourceNames/latestAt` |
| 产品更新 | 200 | 5 | 187 ms | 与 items v1 字段一致 |
| 技巧与观点 | 200 | 5 | 201 ms | 与 items v1 字段一致 |

- 当前状态：`verified_live`。
- 缺失字段：正文、评论和社交平台互动数据；v1 不提供单条正文接口。
- 默认数据语义：`source_kind: news`、`usage_mode: reference_only`。
- 适合云端无人值守只读采集，但不得直接复制摘要公开发布；若把 AIHOT 数据用于面向外部的商业数据产品、代理、镜像或批量再分发，需要另行取得书面授权。

## 风控与无人值守判断

### Cloud Collector 回归验证

2026-08-12 15:38（北京时间）执行 `npm run collect:cloud -- --dry-run`：8 个来源全部成功，AIHOT v1 返回 20 条；整批 RSS/AIHOT 共发现 2,138 条，其中 2,085 条因超过 7 天只进入指纹路径，不会写入当天素材库。运行未写正式数据。

| 来源 | 风控情况 | 是否适合无人值守 |
|---|---|---|
| RSS | 无登录；按来源超时和重试 | 是 |
| AIHOT | v1 匿名只读；需遵守用途许可 | 是 |
| X | Bridge 未连接，登录和 GraphQL 未验证 | 否 |
| 小红书 | Bridge 未连接；真实登录墙和风险控制未验证 | 否 |
| 公众号搜索/正文 | Bridge 未连接；搜狗或微信可能要求人工验证 | 否 |

浏览器平台在出现登录墙、验证码、安全限制或频率限制后，本轮会立即停止该平台，不自动绕过，也不无限重试。

## 唯一待人工操作

在正在运行且已登录平台的 Chrome 中安装或启用与 OpenCLI 1.8.6 匹配的 Browser Bridge 扩展，确认 `opencli doctor` 显示 Extension 和 Connectivity 均为 `OK`。完成后重新运行：

```bash
npm run spike:opencli
npm run collect:browser -- --dry-run
```
