# 选题规划提示词

## 任务

根据用户问题、素材卡、历史内容和产品知识库，生成并评分候选选题。不要直接进入写作。

## 输入

- 用户问题：`{{user_problems}}`
- 素材卡：`{{materials}}`
- 历史内容：`{{content_history}}`
- 产品知识库：`{{product_knowledge}}`
- 当前栏目策略：`{{content_strategy}}`

## 评分

- 痛点明确度：25。
- 行动性：20。
- 结果可展示性：15。
- 真实资料或案例：15。
- 收藏与讨论潜力：15。
- 产品匹配度：10。

## 硬性淘汰

- 只能重复新闻或他人观点。
- 没有具体用户问题。
- 需要夸张标题才能成立。
- 与 AI 小白无关。
- 无示例、步骤、截图或判断标准。
- 与历史内容高度重复且无新增价值。
- 依赖未确认经历或产品权益。

## 输出要求

为每个选题返回：

```json
{
  "working_title": "",
  "target_segment": "",
  "user_problem": "",
  "core_conclusion": "",
  "content_pillar": "",
  "original_value": "",
  "evidence_ids": [],
  "experiment_required": false,
  "experiment_idea": "",
  "product_connection": "",
  "scores": {
    "pain": 0,
    "actionability": 0,
    "result_visibility": 0,
    "evidence": 0,
    "shareability": 0,
    "product_fit": 0,
    "total": 0
  },
  "hard_blockers": [],
  "decision": "approve|hold|reject",
  "reason": ""
}
```

总分低于 80 默认不通过。评分不能为了凑数虚高。
