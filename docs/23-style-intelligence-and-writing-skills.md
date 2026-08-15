---
title: 写作 Skill 编排与风格智能 v0
version: 1.0.0
updated_at: 2026-08-15
status: implemented_pending_real_corpus
---

# 写作 Skill 编排与风格智能 v0

本阶段建立写作前的规则、风格和审查底盘，只运行离线 Fixture。它不生成公众号正文、X 内容或图片，也不发布内容。真实写作由 PR #8 接入。

## 1. 两个固定 Skill

| Skill | 固定版本 | 许可证 | 在系统中的职责 |
|---|---|---|---|
| `human-writing` | `1.1.0` / `4fda173f3fef7fb808f3eba991eeb2528ea4b189` | MIT | 材料门槛、说话位置、中文正向写法、文章推进、节奏、事实边界和初稿后修订 |
| `no-ai-slop` | `d30eddb9e04562234f2070b5ee63ca4649d9a05e` | MIT | 初稿后的 detect-only 审查、模型化结构识别、最小有效修改和 Reviewer 自检 |

文件固定在 `third_party/writing-skills/`。`manifest.yaml` 保存上游 URL、commit、版本、License、每个文件的 SHA-256 和已知可执行文件。`npm run writing-skills:check` 在本地检查这些内容，不从网络下载最新版，也不依赖全局 Skill 安装。

human-writing 的 Python 脚本只作为规则来源和 Fixture 对照。生产 Runtime 继续只依赖 Node.js 和 TypeScript。

## 2. 编排边界

human-writing 在第一稿前只提供材料门槛、说话位置、当前文体结构和正向规则。详细 revision rules 只能在初稿完成后加载。它不创建作者画像。

no-ai-slop 不生成第一稿，只返回以下 Reviewer 字段：

- `issue_code`
- `pattern`
- `quoted_text`
- `location`
- `severity`
- `repair_constraint`

Reviewer 不返回全文重写，不新增事实、案例、观点或个人经历。两个 Skill 不会依次重写同一篇全文。连续重写会把已经存在的个人声音磨平，还可能让第二次改写覆盖第一次保留的事实边界。

规则冲突按以下顺序处理：

1. Research 事实与证据
2. Persona 事实
3. Product Claim
4. 平台硬规则
5. 七天假 Style Profile
6. 当前 Style Recipe
7. human-writing 正向规则
8. no-ai-slop 审查规则

风格规则不能改写事实、产品或平台规则。问题分为 `hard_blocker`、`blocking_style_issue`、`warning` 和 `profile_preference`。只有真实性、抄袭、产品、平台或可读性问题会阻止交付。

## 3. 本机私有语料

默认位置：

```text
~/Library/Application Support/AiAutoContent/style-corpus/
├── sources.local.yaml
├── owner/
├── references/
├── feedback/
└── cache/
```

目录权限固定为 `0700`，文件固定为 `0600`。导入器支持 Markdown、纯文本和 JSONL，并拒绝把 corpus root 放进当前 Git 仓库。`.gitignore` 另有防护。完整文章、用户改稿和 Profile 缓存都只保存在本机。

语料来源声明包含：

- `rights_status`: `owned_by_user`、`licensed`、`public_reference`
- `profile_type`: `owner_voice`、`reference_technique`、`platform_convention`

v0 不自动抓取作者内容，不访问 X、公众号或其他平台。每个参考 Profile 至少需要 8 篇，少于 8 篇时状态为 `insufficient_samples`，不能进入正式 Style Recipe。20 至 30 篇是建议范围，不是代码硬门槛。

## 4. 风格蒸馏与作者模仿的区别

风格蒸馏只保留可以跨主题使用的抽象技巧和统计特征。它不迁移参考作者的身份、观点、个人经历、标志性口头禅、专属比喻、事实 Claim 或客户故事，也不产生“模仿某某”的 Prompt。

`owned_by_user` 可以学习词汇偏好、节奏和稳定判断方式，但历史事实不会自动升级为当前事实。`public_reference` 的 `preferred_terms` 在 v0 固定为空，输出必须带完整 `forbidden_transfer` 清单。模型输出中的来源原句和个人经历会再次由代码过滤。

Codex 风格 provider 复用 `src/local-agent/codex-structured-runner.ts`。一次蒸馏最多调用两次，第一次 Distill，结构非法时允许一次 Repair。语料作为 `untrusted_content`，只读 Runner 不访问链接、不调用工具、不执行语料命令，也不生成文章。CI 和本 PR 验收只使用 Fixture provider。

## 5. Style Profile

`schemas/style-profile.schema.json` 把结果分成三类：

- `content_pattern_profile`: 选题进入、问题定义、证据位置、推进和结束方式
- `language_style_profile`: 句段节奏、第一人称、问句、转折、抽象词与动作词、判断强度和插话方式
- `conversion_pattern_profile`: CTA 位置和长度、免费内容完整度、产品连接、焦虑和步骤省略

TypeScript 在本地确定性计算 sample count、中文字数、句长和段长分位数、句长 CV、单句段比例、第一人称与标点比例、连接词/抽象名词/动作词/数字/例子密度、证据距离、标题/列表密度、开头/结尾/CTA/标题长度分布。指标只描述语料，不等于好坏，也不产生“真人分数”。

## 6. Style Recipe

`schemas/style-recipe.schema.json` 约束每篇写作前选择的少量技巧：

- owner 权重至少 `0.60`
- 所有 reference 合计不超过 `0.30`
- 单个 reference 不超过 `0.20`
- 一次最多两个 reference Profile
- 平台权重不超过 `0.15`

没有可用 owner Profile 时，Recipe 进入 `editorial_voice_human_writing` fallback，不加入参考作者，也不声称系统已经学会七天假的风格。`recipe_hash` 由规范化输入确定性生成，相同输入得到相同结果。

## 7. 动态文章结构

全局固定 3 到 5 步的规则已经移除。结构按 `article_type` 选择：

| 类型 | 结构 |
|---|---|
| `tutorial` | 任务、卡点、步骤、交付物、验收、失败处理 |
| `analysis` | 判断、证据、机制、用户影响、边界、行动 |
| `case_breakdown` | 背景、关键选择、过程、结果、可复用与不可复用 |
| `opinion` | 争议、判断、依据、最强反方、边界、下一步 |
| `checklist` | 场景、判断标准、清单、误用、建议 |

只有 tutorial 和 checklist 强制包含步骤或清单。

## 8. 确定性 Lint 与防抄袭

TypeScript Lint 检查翻案腔、假洞察、机械排比、重复段落作用、过度整齐句长、连续短句、商业黑话、模型路标、名词化、同义词轮换和不合格结尾。冒号和破折号按上下文处理。代码、URL、Markdown 元数据、正常教程列表标签和来源字段不会被机械报错。

防抄袭只把待审内容与本机语料比较，不上传第三方语料。检测包含最长连续字符、中文 12-gram 重合、标志性短语、专属比喻和个人经历实体。Research Pack 中精确授权并映射合法 Claim ID 的 quote 可以豁免。public reference 的未授权长句重合是 `hard_blocker`，不能改几个词后重试，必须重新组织观点和结构。

## 9. 人工修改反馈

最终人工改稿保存在 `style-corpus/feedback/`，包含 before、after、接受和拒绝的修改、reason labels、平台、文体和时间。一次修改不会改变 Profile。至少三次同方向修改后，系统只生成 `proposed_profile_delta`，仍需用户明确批准才能升级 Profile 版本。

## 10. 命令

```bash
npm run writing-skills:check
npm run style:import -- --source <file> --profile-id <id> --profile-type owner_voice --rights-status owned_by_user --platform wechat --content-type tutorial
npm run style:inspect
npm run style:distill -- --fixture
npm run style:feedback -- --before <file> --after <file> --reason-labels more_concrete --platform wechat --article-type tutorial
npm run style:lint -- --fixture
```

## 11. PR #8 的消费方式

PR #8 只能在 Research Pack 达到写作门槛后调用这些能力。顺序是：加载事实和产品约束，选择 Style Recipe，加载 human-writing 初稿前规则，生成一份初稿，再加载 revision rules 和 no-ai-slop detect-only Reviewer，运行确定性 Lint 与防抄袭，最后等待人工确认。PR #8 不能恢复串行全文重写，也不能把 Fixture 成功当成真实七天假语料已经接入。
