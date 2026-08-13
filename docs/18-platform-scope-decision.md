---
title: 平台范围决策
version: 1.0.0
updated_at: 2026-08-13
status: approved
---

# 平台范围决策

## 决策

2026-08-13，用户主动决定降低账号与自动化风险，退出小红书采集、内容生产、发布与数据复盘。

当前正式范围：

- 素材采集：RSS、AIHOT、X、微信公众号。
- 内容生产：微信公众号文章与配图、X Post / Thread。
- Cloud Collector：RSS / AIHOT。
- Local Browser Collector：X / 微信公众号。

## 退出边界

活跃代码、查询配置、Collector Registry、默认 Browser Pipeline、LaunchAgent、当前日报、平台提示词、内容模板和发布包中不得存在小红书执行入口。不能用 `enabled: false` 代替移除。

`sourcePlatformSchema` 暂时保留 `xiaohongshu`，状态为 `deprecated_history_only`，目的仅是让历史 JSON 行继续通过 Schema。它不是当前平台能力。

## 历史审计

`docs/14-opencli-live-capability-spike.md`、`docs/16-codex-browser-runtime-spike.md` 和 `docs/17-opencli-browser-live-validation.md` 记录了过去真实发生的失败与成功验证。这些文档保留原始事实，只增加退役提示，不删除、不改写，也不伪装成从未验证过。

未来 Agent 不得根据旧验证文档擅自重新启用。若要恢复，必须由用户明确重新批准，并通过新的产品风险评估、代码变更和真实验证。
