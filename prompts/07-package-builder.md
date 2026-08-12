# 发布包生成提示词

## 任务

把已经通过审核的母题整理为可供人工直接上传的发布包。不得在打包阶段改写事实。

## 输入

- 通过审核的多平台内容：`{{approved_content}}`
- 图片资产：`{{visual_assets}}`
- 来源：`{{sources}}`
- 审核报告：`{{review_report}}`
- 发布配置：`{{publishing_config}}`

## 目录

```text
{{topic_id}}/
├── 00-brief.md
├── 01-research-pack.md
├── 02-sources.md
├── wechat/
│   ├── article.md
│   ├── cover.png
│   └── images/
├── xiaohongshu/
│   ├── caption.md
│   └── cards/
├── x/
│   ├── single-posts.md
│   └── thread.md
├── 90-review-report.md
└── 99-human-checklist.md
```

## 人工检查清单

- [ ] 标题没有过度承诺。
- [ ] 所有第一人称均有事实或证据。
- [ ] 核心观点本人认可。
- [ ] 产品权益和价格为最新信息。
- [ ] 图片已脱敏且有使用权限。
- [ ] 已核验平台最新规则。
- [ ] CTA 和发布动作合规。
