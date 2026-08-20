---
title: Simple Writing v1 单次写作链路
version: 1.0.0
updated_at: 2026-08-20
status: implemented_fixture_verified_not_production_activated
---

# Simple Writing v1

## 1. 目标与边界

Simple Writing v1 只解决一件事：已有每日选题时，使用已经保存且能追溯的关联素材，一次调用 Writer，生成一篇放在本机私有目录、等待人工审核的微信公众号草稿。

固定流程：

```text
Topic Decision
→ Persisted Sources
→ One Writer Call
→ Four Simple Code Checks
→ Local Private Markdown
→ Human Review
```

这条链路不复制 PR #8 的高级安全实验，不包含 PublicContentUnit、Audit Engine、Reviewer、Repair、写作实验、多模型角色、风格审批链、图片、X 内容或自动发布。PR #8 继续作为独立 Open Draft 存在。

Research Pack 可以在未来作为已核验短引用的补充来源，但当前不是写作门禁。`RESEARCH_INCOMPLETE` 不会自动阻塞 Simple Writing，Simple Writing 也不会启动新的 Research 或对照实验。

## 2. 输入

`src/simple-writing/input.ts` 复用：

- `readExistingTopicDecision()` 读取 `data/topic-decisions/YYYY-MM-DD.json`。
- `buildTopicMaterialInput()` 按现有 Topic 配置重新得到最近 72 小时的可用素材卡。

Simple Writing 不重新访问网页、X、公众号或 Browser Bridge。Writer 只收到 Topic 已引用且当前仍有非空持久化 excerpt、可追溯 canonical URL 的素材。输入保留：

- `material_id`
- `source_name`
- `source_type`
- `title`
- `published_at`
- `canonical_url`
- `excerpt`
- `content_scope`
- `source_status`

Topic 不存在、`NO_PUBLISH` 或没有可用关联素材时，不创建真实 Provider，也不读取 Writer 模型环境。

## 3. 四个业务决定

| 条件 | 决定 | model.calls |
|---|---|---:|
| Topic 文件不存在 | `WAITING_FOR_TOPIC` | 0 |
| Topic 为 `NO_PUBLISH` | `NO_CONTENT` | 0 |
| `SELECT_TOPIC` 但没有非空、可追溯素材 | `BLOCKED_NO_SOURCES` | 0 |
| Writer 输出无 hard failure | `READY_FOR_HUMAN_REVIEW` | 1 |

Provider 创建失败、超时、非法输出或代码 hard failure 都是 `status=failed`、`decision=null`。只要当天已经尝试 Writer，Scheduler 当天不再进行第二次模型调用。

## 4. Writer

接口只有：

```ts
write(input): Promise<SimpleWritingProviderCall>
```

实现：

- `CodexCliSimpleWritingProvider`
- `FixtureSimpleWritingProvider`

没有 `review()` 和 `repair()`。真实实现复用 `CodexStructuredRunner`：非交互、显式模型、read-only sandbox、approval never、临时非 Git 目录、Zod 生成的 output schema 和 output-last-message。

环境变量优先级：

```text
SIMPLE_WRITING_CODEX_BIN   → WRITING_CODEX_BIN   → PATH 中的 codex
SIMPLE_WRITING_CODEX_MODEL → WRITING_CODEX_MODEL → gpt-5.6-sol
```

每次 Build 最多调用一次 Provider。成功、失败、超时或非法输出都算一次，不自动重试。

## 5. 输出结构

唯一 Writer 结构是 `SimpleWriterOutput`：

```text
primary_title
alternative_titles（正好两个）
abstract
article_markdown
used_source_ids
uncertain_points
human_review_notes
```

不输出 Claim ID、产品 Claim、Persona、Style Rule、X、图片、Visual Slots、Reviewer、Repair 或思维过程。

## 6. 四类代码检查

`runSimpleWritingChecks()` 是普通函数，不是 Audit Engine。

1. Output：严格 Schema、正文和标题完整性；失败为 hard failure。
2. Source Integrity：未知 source ID、输入之外的 URL 为 hard failure。
3. Basic Safety：明显第一人称实测、客户学员、保证结果、名额涨价、价格和退款短语只产生 warning。
4. Basic Format：少于 1000 或多于 3000 个中文字符只 warning；内部字段、素材 ID 和本机绝对路径为 hard failure。

Warnings 会写入 `review-notes.md`，但不阻塞 `READY_FOR_HUMAN_REVIEW`。

## 7. 本机文件

真实默认目录：

```text
~/Library/Application Support/AiAutoContent/simple-writing/YYYY-MM-DD/
```

成功只生成：

```text
article.md
sources.md
review-notes.md
simple-writing-pack.json
```

目录固定 `0700`，文件固定 `0600`，拒绝写入 Git 仓库内部。`article.md` 不显示内部素材 ID；`sources.md` 是内部审阅文件，可以显示使用的 `material_id` 和原始链接。

dry-run 默认写入：

```text
/tmp/ai-auto-content-simple-writing-<timestamp>-<random>/
```

仓库不生成 `data/writing-packs/**`、`data/writing-runs/**`、`reports/writing/**` 或文章草稿。

## 8. CLI 与离线 Fixture

Ready Fixture：

```bash
npm run simple-writing:build -- --fixture --dry-run --date=2026-08-14
```

其他零模型分支：

```bash
npm run simple-writing:build -- --fixture --dry-run --date=2026-08-14 --fixture-scenario=no-publish
npm run simple-writing:build -- --fixture --dry-run --date=2026-08-14 --fixture-scenario=waiting
npm run simple-writing:build -- --fixture --dry-run --date=2026-08-14 --fixture-scenario=no-sources
```

Fixture 使用合成 Topic、合成素材和合成文章，不读取真实 Codex 环境，不访问平台或网络。`model.provider=fixture`；Ready 为一次 Fixture Provider 调用，其余三种分支为零调用。

## 9. Scheduler

仓库代码新增 `simple_writing` 窗口：北京时间 14:30—22:00。状态单独保存在：

```text
~/Library/Application Support/AiAutoContent/state/simple-writing-state.json
```

状态只记录日期、业务状态、是否尝试模型、模型调用数、输出目录、安全错误码和更新时间。Topic 尚未出现或素材暂时为空时可以在窗口内稍后检查；`NO_CONTENT`、已生成草稿或已经尝试过 Writer 时，当天跳过。

本 PR 只接线和运行离线 Fixture，没有安装或 reload LaunchAgent，没有修改当前生产 Runtime，也没有执行真实定时写作。生产激活必须等 Draft PR 人工验收、合并后另行决定。

## 10. Human Gate

每个 Pack 固定：

```text
required=true
status=unreviewed
automated_publish_allowed=false
```

`READY_FOR_HUMAN_REVIEW` 只表示四个本机文件已经生成。人仍需检查事实、表达、标题和引用来源，然后自行修改、复制和发布。系统不会生成图片、访问发布平台、上传草稿箱或自动发布。
