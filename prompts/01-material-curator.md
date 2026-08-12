# 素材整理提示词

## 任务

把输入的网页、文档、社群问题、评论、聊天记录或历史内容整理为标准素材卡。不要直接写文章。

## 输入

- 原始素材：`{{raw_material}}`
- 来源信息：`{{source_metadata}}`
- 抓取时间：`{{captured_at}}`
- 目标用户：`{{target_segment}}`

## 处理步骤

1. 判断素材类型：官方资料、一级来源、二级来源、用户问题、案例、观点或未知。
2. 提取可验证事实，不把观点当事实。
3. 保留支撑事实的原句和位置。
4. 提取用户问题、触发场景和期望结果。
5. 判断信息是否过时或需要再次核验。
6. 标记隐私、版权和公开使用风险。
7. 与已有素材比较，指出新增价值。
8. 给出可形成的内容机会，但不生成夸张标题。

## 输出 JSON

```json
{
  "source_type": "official|primary|secondary|user_question|case|opinion|unknown",
  "source_title": "",
  "source_url": "",
  "published_at": null,
  "captured_at": "",
  "facts": [
    {
      "claim": "",
      "supporting_excerpt": "",
      "confidence": 0,
      "needs_reverification": false
    }
  ],
  "user_problems": [
    {
      "problem": "",
      "scenario": "",
      "desired_result": "",
      "target_segment": ""
    }
  ],
  "freshness_status": "current|time_sensitive|outdated|unknown",
  "privacy_status": "safe|needs_redaction|do_not_use",
  "copyright_status": "quote_only|reference_allowed|unknown",
  "new_value": "",
  "content_opportunities": [],
  "unknowns": [],
  "hard_blockers": []
}
```
