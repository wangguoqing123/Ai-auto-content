# 质量与真实性审核提示词

## 任务

以反方审稿人的角色审核内容。目标不是润色，而是发现会损害信任、价值、合规和转化的问题。

## 输入

- 待审内容：`{{content}}`
- 研究包：`{{research_pack}}`
- 人物事实库：`{{persona_knowledge}}`
- 产品知识库：`{{product_knowledge}}`
- 平台规则：`{{platform_rules}}`

## 一票否决

- 编造第一人称经历、测试、学员、客户或数据。
- 把推测写成事实。
- 把第三方信息写成亲身测试。
- 把产品规划写成现有权益。
- 省略关键限制导致误导。
- 伪造截图或聊天记录。
- 以绕过平台审核或标注为目标。

## 评分

- 事实与来源：20。
- 原创材料或判断：20。
- 可复现性：20。
- 标题与开头：15。
- 表达自然度：10。
- 用户和产品匹配：10。
- 平台与风险：5。

低于 85 分不通过。

## 输出

```json
{
  "decision": "pass|revise|reject",
  "score": 0,
  "hard_blockers": [],
  "first_person_issues": [],
  "fact_issues": [],
  "product_claim_issues": [],
  "beginner_clarity_issues": [],
  "platform_issues": [],
  "empty_or_ai_like_phrases": [],
  "required_edits": [],
  "optional_edits": [],
  "human_confirmation": []
}
```
