---
title: 自动研究、证据核验与安全实验包 v0
version: 1.0.0
updated_at: 2026-08-15
status: implemented_live_validation_verified_pending_local_activation
---

# 自动研究、证据核验与安全实验包 v0

## Writing Research Gate

Writing 只消费严格 Schema-valid 的 Research Pack：missing/failed → `WAITING_FOR_RESEARCH`；`NO_TOPIC` → `NO_CONTENT`；`RESEARCH_INCOMPLETE` → `BLOCKED_BY_RESEARCH`；只有 `READY_FOR_WRITING` 进入 Style Resolver。前三条路径 `model.calls=0`，且发生在 Style Hash、Codex 模型配置和 Provider 初始化之前。

Evidence Audit 只允许 direct Claim 作为事实；partial 必须保留“目前能确认的是”和 scope，不能进入标题核心、强结论或强 CTA；unsupported 禁止使用。实验数字从已保存结果读取，正文必须同时说明单样例、每组一次、未测模型波动和不可外推。

项目自有 `synthetic-ready-research-pack` 只包含去敏合成会议记录、三项待办/负责人、两项截止时间、一项缺验收标准、合成实验与限制，不含第三方完整内容、真实人物、真实公司数据或真实销售信息。

## 1. 唯一职责

研究层只接受当天严格合法的 Topic Decision：

```text
SELECT_TOPIC
→ 读取 selected_topic 与 fact_source_ids
→ 按第一方来源梯度获取指定事实材料
→ 清洗并编号本机来源段落
→ 精确核验 Claim 引用
→ 回答原 research_questions
→ 必要时运行一次 baseline 与一次 structured 文本实验
→ 代码计算验收项
→ READY_FOR_WRITING 或 RESEARCH_INCOMPLETE
```

`NO_PUBLISH` 直接得到 `NO_TOPIC`，不抓网页、不创建 Provider、不调用 Codex、不运行实验。Topic 文件缺失、损坏、日期不符、Schema 非法或 `status=failed` 都是研究基础设施失败：`status=failed`、`decision=null`。Codex、文件或 Schema 故障不能伪装成 `RESEARCH_INCOMPLETE`。单条来源不可用属于证据缺口；只有全部指定来源都不可用时才是 `source_fetch_failed`。

本层不生成正文、正式标题、封面、配图、提示词、草稿、发布动作或复盘。`READY_FOR_WRITING` 只表示写作输入达到门槛，不表示已经写稿。

## 2. Topic 绑定和来源范围

Research Pack 绑定 Topic Decision 的 `input_hash`、`run_id`、`topic_signature` 与 selected topic 快照。研究代码不重新打分、不换题、不升级 CTA、不替换产品模块，也不添加未确认产品权益。

v0 只读取 `selected_topic.fact_source_ids` 对应材料，并要求：

- 材料存在、`status=accepted`、`source_access_status=resolved`。
- 代码重新分类后仍为 `fact_source`。
- canonical URL 为 HTTP(S)，不含用户名、密码或微信临时访问参数。
- 不允许 X、小红书、`trend_signal`、`structure_inspiration`、`reference_only` 或 `restricted_inspiration_only` 自动抓全文。
- 不做开放式搜索，不跟进文章中的链接，不访问登录页面、本机浏览器、Cookie 或 Browser Profile。

当前 2026-08-14 Topic 只允许抓取两条 OpenAI 官方材料。真实 dry-run 明确禁止访问 X 和公众号。

## First-party source acquisition fallback

每条 Topic fact source 独立执行同一梯度，互不连带终止：

1. `canonical_http`：只请求一次材料的 canonical URL。
2. `official_rss_replay`：若 canonical 返回 401/403/429 或 JavaScript/Cookie challenge，不绕过访问控制；只有原 Material 明确来自 `collector=rss`、`source_kind=official`、`source_type=rss`、`source_tier=primary`，且 `source_id` 在 `config/sources.yaml` 中仍为启用的 RSS，才请求同一第一方官方 Feed。
3. `persisted_official_rss_excerpt`：Feed 不可访问或已不含历史 item 时，仅使用采集阶段已经保存的该官方 RSS item 标题和摘要。
4. `unavailable`：不满足以上条件或无安全摘要时，来源保持失败清单；不会改用搜索、浏览器、Cookie、缓存网页或第三方正文代理。

RSS Replay 只选择 canonical URL、`source_item_id`、item link 或 guid 匹配的单个 item，按 `content:encoded → content → summary → description → contentSnippet` 取内容；完整 Feed 不进入 Codex、Cache 或 Git。Material 的 RSS/primary 血缘来自 Cloud Material 原字段，Browser Material 不补推断，也不根据 `openai.com` 等域名猜测。

每个 Source Manifest 明确保存 `retrieval_method`、`content_scope`、`retrieval_url`、`canonical_fetch_status`、HTTP 状态、降级原因和原快照时间。`feed_excerpt` 只证明标题与摘要中直接出现的内容，不等于完整文章，不能支持摘要外企业细节或数字。其稳定 SHA-256 只取规范化的 title、excerpt、published_at、source_id 与 canonical_url，不包含 `collected_at`。

## 3. 公共 URL 与 SSRF 防护

`src/research/url-safety.ts` 和 `source-fetcher.ts` 在每次请求及每个重定向前重新执行：

1. 解析 URL，只接受 HTTP/HTTPS 和标准 80/443 端口。
2. 拒绝 URL 用户名、密码、localhost 与 IP 字面量非公网地址。
3. 通过固定公网 IP、TLS SNI 和 64 KiB 响应上限访问公共 DNS-over-HTTPS 解析器，A/AAAA 的所有返回地址都必须是公网 unicast；这也避免本机 TUN/Fake-IP DNS 的 `198.18.0.0/15` 保留地址被误当成来源服务器。
4. 拒绝 loopback、私网、link-local、IPv6 unique-local、multicast、metadata、CGNAT、文档网段和保留地址。
5. 连接固定到已验证地址；HTTPS 保留原 hostname 的 SNI 与 Host。
6. 手动处理重定向，最多 5 次；重定向目标重新走完整检查。

请求使用固定安全 User-Agent，不发送 Authorization 或 Cookie；20 秒超时、2 MiB 最大响应、允许类型白名单和 `Accept-Encoding: identity`。返回对象不暴露响应 headers，因此 `Set-Cookie`、服务器内部 header 或认证信息不会写盘。

## 4. 清洗快照与版权边界

HTML 使用成熟解析器移除 `script`、`style`、导航、页脚、侧栏、广告和 Cookie banner，优先 `article`、`main`、`role=main`，最后才是 `body`。文本执行 NFKC 和空白归一化，单段最多 4,000 字符，总清洗文本最多 80,000 字符，按稳定顺序编号 `p0001`、`p0002`。

完整清洗段落只写入：

```text
~/Library/Application Support/AiAutoContent/research-cache/
```

目录权限 `0700`，文件权限 `0600`，默认最多保留 7 天；使用 `npm run research:cache:clean -- --older-than-days=7` 清理。缓存不在 Git 仓库内，不进入采集、写作或其他流程。

Git 只保存来源身份、安全 URL、标题、作者、抓取时间、类型、内容 SHA-256、状态和被 Claim 选中的短引用。单条引用最多 500 字符，单来源所有提交引用合计最多 1,500 字符；不提交 HTML、完整网页、完整清洗正文、脚本、样式、Codex 事件流、完整原始响应或思维链。

## 5. Claim 和研究问题

研究 Agent 输出 `direct | partial | unsupported` Claim。代码逐项验证 source、Topic 声明的 fact_source 归属、segment、quote 连续子串和两级引用长度。`partial` 必须写 `scope_limit`；`unsupported` 不得含引用，但仍保留在 Research Pack 中形成可审计缺口，并自动从写作必用 Claim 中移除。时效 Claim 的 partial/unsupported 是业务证据缺口，不是输出结构错误。

引用 `feed_excerpt` 的 direct/partial Claim 必须在 `scope_limit` 明确“官方 RSS 摘要、未核验全文”；Claim 或答案中的数字必须真实出现在精确 quote 内。缺少 Topic 声明的 Claim 记录、未知 source/segment/claim 或伪造 quote 仍是结构错误。

Quote 不匹配时只允许一次结构修复；第二次仍不匹配即 `status=failed`、`error_code=invalid_source_quote`，不做近义匹配。

研究答案必须逐字对应 Topic Decision 中原问题，并带 `gap_impact`。`answered` 要求 `none` 且无 remaining gap；允许项目自带实验目录直接回答非事实型任务选择问题。`partial` 要求非空缺口和 `non_blocking | blocking`；`unanswered` 要求 `blocking` 且不伪造答案。`unanswered`、blocking partial 或引用 unsupported Claim 都不能通过研究问题门槛；non-blocking partial 可以通过这一门槛。

## 6. Codex 隔离执行

Topic 与 Research 共用 `src/local-agent/codex-structured-runner.ts`：解析 Codex 路径、探测版本和能力、检查 login status，使用参数数组与 `shell=false`，显式模型、`--sandbox read-only`、`--ask-for-approval never`、ephemeral、严格 JSON Schema 和 `output-last-message`。

每次调用在 Runtime clone 外部的非 Git 临时目录执行，只继承 `HOME`、`PATH`、`LANG`、`LC_ALL`、`TERM` 和可选 `CODEX_HOME`；不会继承 `OPENAI_API_KEY`、GitHub Token、Cookie 或 Browser Secret。网页段落全部标为 `untrusted_content`，Codex 被明确禁止访问链接、工具、仓库或外部文件。

单次 Research Pack 最多 4 次 Codex 调用：研究一次、必要时结构修复一次、baseline 一次、structured 一次。每次在调用前记账，因此 timeout、rate limit、进程失败或非法输出也保留真实 attempt 数；不会反复运行实验直到得到偏好结果。

## 7. 安全实验和确定性验收

`config/experiment-task-catalog.yaml` 只列出三个项目自带合成 `text_to_text` 任务：

- `public_notes_to_action_brief`
- `product_request_to_acceptance_checklist`
- `meeting_notes_to_decision_log`

禁止 shell、浏览器、网络搜索、Git、删除、平台账号、宿主机代码执行、私人数据、企业机密、邮件或发布。

同一实验的两个 Variant 使用同一个 Codex CLI、模型、合成输入、严格输出 Schema 与时间上限；只改变任务说明：A 是普通聊天式需求，B 是包含目标、背景、输入、步骤、格式、验收和失败条件的完整任务卡。

模型的 `self_check` 仅作为实验输出保存；最终八项验收由项目代码重新计算：交付物、必需字段、缺失输入、可执行下一步、验收映射、无依据假设、严格格式和是否需大幅补充。记录通过/失败数、缺失字段、解析状态、耗时、token usage 和退出状态。

结论只描述本次合成样例的观察差异。Research Pack 固定披露：只有一个样例、每组只跑一次、没有测量模型波动，不能外推所有任务、模型、用户、Agent、效率百分比或通用准确率。

## 8. READY_FOR_WRITING 门槛

只有全部满足才能进入 `READY_FOR_WRITING`：

- Topic 是成功的 `SELECT_TOPIC`，快照未被替换。
- 原时效 `supported_claims` 都有足够范围的 direct 精确短引用；`feed_excerpt` 只证明摘要本身，不能补成全文细节。
- 所有使用来源均为原 Topic fact_source，所有 quote 通过连续子串检查。
- 原 research questions 全部有可接受答案，没有 unanswered、blocking gap 或 unsupported 依赖。
- 要求实验时，两组各成功一次、严格 Schema 合法、代码验收已记录且 limitations 非空。
- 写作要求完整记录风险、披露、证据和禁止表达。
- 不包含 restricted、小红书、UGC 事实或未确认产品权益。

任何研究业务门槛未满足为 `RESEARCH_INCOMPLETE`，禁止自动写作。只要至少一个事实来源可用且 Provider/实验基础设施正常，其他来源失败也生成可审计的 `RESEARCH_INCOMPLETE`；全部来源不可用才是 `status=failed`。

## 9. 幂等、文件和 CLI

幂等判断发生在本次 Source Acquisition 之后。`input_hash` 包含 Topic Decision hash/signature/快照、来源血缘、实际 retrieval method/content scope/canonical 状态/`content_sha256`、研究/来源/实验/产品配置、Provider、模型、Codex 版本、Prompt 版本和 Research Pack Schema 版本。同日成功且当前 hash 相同才返回 `ALREADY_RESEARCHED`：本次仍已重新核验来源，但不调用模型、不重复实验；来源内容或获取范围变化会形成新 hash 并允许重跑。

正式输出仅为：

```text
data/research-packs/YYYY-MM-DD/research-pack.json
data/research-packs/YYYY-MM-DD/source-manifests/*.json
data/research-packs/YYYY-MM-DD/experiments/*.json
data/research-runs/research_<timestamp>.json
reports/research/YYYY-MM-DD.md
```

命令：

```bash
npm run research:build -- --date=2026-08-14
npm run research:build -- --dry-run --date=2026-08-14
npm run research:build -- --fixture --date=2026-08-14
npm run research:validate -- data/research-packs/2026-08-14/research-pack.json
npm run research:inspect -- --date=2026-08-14
npm run research:cache:clean -- --older-than-days=7
```

Fixture 不访问网络、不调用真实 Codex、不修改本机缓存。dry-run 允许抓取指定官方来源、调用本机 Codex 和运行两个文本 Variant，但不写正式仓库文件或创建 Git commit。

## 10. Scheduler、Git 和当前边界

Mac Local Scheduler 顺序为 Morning → Topic Selection → Research Pack。Research 窗口是北京时间 13:30—21:00，最多 2 次尝试。Topic 不存在时返回 `WAITING_FOR_TOPIC`、exit 0、不增加尝试；`NO_PUBLISH` 当天以 `NO_TOPIC` 完成；相同成功输入返回 `ALREADY_RESEARCHED`。

Research 自动提交只允许 `data/research-packs/**`、`data/research-runs/**`、`reports/research/**`，标题固定为 `chore(research): build evidence pack YYYY-MM-DD`。提交前后及 pending 恢复都会验证固定标题、日期、白名单、严格 Schema、敏感信息、绝对路径和文件大小；冲突 abort，保留本地 commit，不 force、不重新调用 Codex。

本 PR 阶段不会安装、重装或 reload LaunchAgent，不修改生产 Runtime clone，不运行 Browser Collector，不访问 X 或公众号，也不生成正文、图片或发布。

第一次获准的 2026-08-14 真实 `--dry-run` 中，两条 OpenAI canonical URL 均返回 HTTP 403 JavaScript/Cookie challenge；系统没有绕过，而是从 `https://openai.com/news/rss.xml` 成功匹配两条 item，得到 2/2 个 `official_rss_replay` / `feed_item` 快照并写入 0700/0600 本机 Cache。随后首次 Research Analyze 已发生并计为 1 次，但其结构化结果因旧契约额外要求 answered 问题必须引用事实 Claim 而被拒绝为 `codex_output_invalid`；baseline 与 structured 均未运行，正式 Research Pack 未写入。该失败记录保留不变；额外限制随后已按本版 `gap_impact` 规则移除并完成离线回归。

第二次获准的真实 `--dry-run` 于 2026-08-15 对同一个 2026-08-14 Topic Decision 执行且只执行一次。两条 canonical URL 各返回一次 HTTP 403，系统仍未绕过访问控制，并从 OpenAI 官方 RSS 取得 2/2 个 `official_rss_replay` / `feed_item`，`unavailable=0`。Analyze 形成 2 条 `partial` Claim 和 3 个研究答案：1 个 answered、1 个 non-blocking partial、1 个 blocking unanswered，因此业务决定为 `RESEARCH_INCOMPLETE`，不是 `READY_FOR_WRITING`。未触发 Repair；baseline 与 structured 各运行一次，均为 `status=success`、`output_parse_status=valid`、代码验收 6 pass / 2 fail、缺失必需字段为 0。总计 3 次 Codex 调用，模型耗时 138,071 ms；dry-run 明确返回 `files_written=false`，没有写正式 Research Pack、运行记录或报告，也没有修改生产 Runtime、LaunchAgent、Topic、正文、图片或发布状态。当前阶段据此更新为 `implemented_live_validation_verified_pending_local_activation`；它只表示真实本机 dry-run 链路已验证，生产激活仍需合并后由用户显式执行。
