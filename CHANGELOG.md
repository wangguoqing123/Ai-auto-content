# Changelog

## Unreleased

- 增加极简 Simple Writing v1：复用现有 Topic Decision、72 小时素材 Loader 和只读 Codex Structured Runner，固定为 Topic → Sources → One Writer → 四类代码检查 → Human Review；正常最多一次 Writer 调用，没有 Reviewer、Repair 或多 Audit 编排。
- 草稿只写入 Runtime clone 外的 0700/0600 本机私有目录，成功生成 `article.md`、`sources.md`、`review-notes.md` 和 `simple-writing-pack.json`；Warnings 不阻塞人工审核，任何 hard failure 都不自动重写或重跑。
- 增加 14:30—22:00 Simple Writing Scheduler 代码与离线 Fixture；本轮没有真实 Writing Codex 调用、平台访问、图片、发布、正式 Writing 数据、生产 Runtime 修改或 LaunchAgent 安装/reload。
- 固定 vendored human-writing 1.1.0（`4fda173f3fef7fb808f3eba991eeb2528ea4b189`）与 no-ai-slop（`d30eddb9e04562234f2070b5ee63ca4649d9a05e`），保留 MIT License、上游 URL、逐文件 SHA-256 和已知可执行文件 allowlist；CI 不联网下载 Skill。
- 增加本机 0700/0600 私有 style corpus，支持 Markdown、纯文本和 JSONL 导入；完整文章、反馈和 Profile 缓存不进入 Git，也不自动抓取作者内容。
- 增加严格 Style Profile 与 Style Recipe Schema，分离内容、语言和转化模式，计算确定性节奏指标，并限制 owner/reference/platform 权重与最多两个参考 Profile。
- 复用只读 Codex structured runner 完成最多 Distill + Repair 两次风格蒸馏；CI 继续只用离线 Fixture，另在用户明确授权下用项目自有合成语料完成一次真实 Codex 集成验证。
- 增加动态 article type 结构、human-writing 前后阶段 adapter、no-ai-slop detect-only Reviewer、规则优先级、上下文敏感 TypeScript Lint 和本机防抄袭。
- 增加人工改稿反馈记录；一次改稿不更新 Profile，三次一致修改只产生待用户批准的 `proposed_profile_delta`。
- 本阶段不生成正式公众号文章、X 内容、图片或发布包，也不访问 X、公众号、Browser Bridge、生产 Runtime、Scheduler 或 LaunchAgent。
- 加固 Style Recipe：`selected_rules` 成为唯一事实源，逐条保存 Profile、来源角色、实际权重和选择原因；owner/reference/platform/baseline 通过确定性配额与交错真实参与选择，权重总和严格校验为 1。
- Corpus Document 增加 creator、canonical URL、platform item、发布时间、权利依据、许可记录、确认时间和显式 model-processing consent；同 Profile 按正文 hash 与来源 item 去重，denied 文档零 Codex 调用并产出 `processing_not_allowed`。
- 增加最多 30 篇、单篇 12,000 字符、总计 240,000 字符的确定性开头/中段/结尾输入预算，分别记录完整 corpus hash、实际 model input hash、逐篇覆盖率，并把 evidence distance 改为单篇计算后按判断数量加权。
- 增加本机 0700/0600 Protected Transfer Index；候选必须是原文连续精确子串，短口头禅、专属比喻、个人实体和独特片段只进入 Reviewer，不进入 Profile、Recipe 或 Writer。
- Research Quote 豁免改为只接收经过严格 Research Pack Schema、READY_FOR_WRITING 状态和 Claim/quote/source/segment 全字段核对的内部对象；正文仍必须显式使用引号或 Markdown 引用块。
- 删除“工具/应用/平台/系统”共现的指代误报，新增结构化 Entity Naming Audit；区分商业硬黑话和学习/反馈/执行闭环等 warning，并把完全重复段落准确命名为 `exact_duplicate_paragraph`。
- 增加带 Skill commit、来源文件/章节、适配方式与严重度的 Adaptation Map；Writing Issue 保存 `rule_origin` 和 `source_commit`，运行时不直接加载上游 Skill 文件作为 Prompt。
- 反馈一致性改为同一 change signature、三个不同 Writing Pack、三个不同 draft、兼容平台/文体且零 rejection；Proposal 保存支持反馈 ID，仍只提案、不自动更新 Profile。
- 完成真实语料导入前的最终加固：同一 Profile 只要一篇 denied 就完全跳过 Codex 初始化、环境读取与 CLI 探测；JSONL 顶层 rights/model consent 覆盖直接拒绝，授权只来自 CLI 或可信本地 Manifest。
- Corpus Root、Source 与私有树改为逐次 lstat/realpath、拒绝 symlink 和特殊文件；`secureCorpusWrite` 使用同目录 0600 临时文件、fsync 与 atomic rename，读写都复验私有权限和真实仓库边界。
- Style Distill 改为严格 Bundle，一次响应同时生成抽象 Profile 与 Public Reference Protected Candidates；代码重扫完整 Corpus、重算真实来源 ID、自动写入或在 hash 变化时重建 Index，Owner/已授权语料禁止返回候选，总调用仍最多两次。
- Protected Resolver 使用不可伪造内部句柄；生产 Lint 对 Index 缺失、过期、非法或不安全 fail closed。新增只输出 hash、时间、状态和分类计数的 `style:protected:inspect`，Profile、Index、Inspect 与 Lint 统一使用 `computeStyleCorpusHash()`。
- 完成 Synthetic live Codex integration validation：`codex-cli 0.147.0` / `gpt-5.6-sol` 对合成 Owner/Reference 各 8 篇分别执行 1 次外层 Distill，内部均 1 次调用并返回 `ready`；自动 Index 为 2/1/1/1，Recipe 为 owner 0.80 / reference 0.20、rules 10/2，正常 Lint、Protected hard block 与 stale rejection 均通过。未导入真实语料、访问平台、生成内容或提交任何临时产物，状态保持 `implemented_live_provider_verified_pending_real_corpus` 而非 production。

- 增加自动研究、证据核验与安全实验包 v0：严格消费正式 Topic Decision，只输出 `READY_FOR_WRITING`、`RESEARCH_INCOMPLETE` 或 `NO_TOPIC`，基础设施故障保持 failed。
- 增加公共 URL 与 SSRF 防护：HTTP(S)/80/443、每次请求和重定向 DNS 全地址检查、固定已验证 IP、20 秒超时、2 MiB 上限和 Content-Type 白名单。
- 增加本机 0700/0600 研究缓存、7 天清理命令和第三方版权边界；Git 只保存精确短引用，单条 500 字符、单来源合计 1,500 字符。
- 抽取 Topic/Research 共用 Codex 结构化 Runner；Research 最多 4 次调用，baseline/structured 各只运行一次，八项验收由代码计算。
- 增加 13:30—21:00 Research Scheduler、`WAITING_FOR_TOPIC`/`ALREADY_RESEARCHED`、Research Git 白名单、严格 Schema 敏感扫描和 pending commit 恢复；PR 阶段不修改生产 Runtime 或 LaunchAgent。
- 增加第一方来源获取梯度：canonical 被访问控制阻止时，只降级到同一官方 RSS item；历史 item 缺失时仅使用已保存的官方 RSS 标题/摘要，并把 retrieval method、content scope、canonical 状态与降级原因写入 Manifest。
- 保留 Cloud Material 的 `source_type`/`source_tier`/`source_id` 血缘，不按域名推断 RSS 资格；单来源失败继续形成 `RESEARCH_INCOMPLETE`，全部来源失败才是 `source_fetch_failed`。
- 将 partial/unsupported/time-sensitive 证据不足从结构错误分离为 open gaps；新增 `gap_impact`，blocking partial 阻止写作，non-blocking partial 可通过问题门槛；feed excerpt 不得支持摘要外细节或数字。
- 幂等判断移到当前来源获取和 hash 计算之后；hash 纳入获取方式、内容范围、canonical 状态与当前 Provider/模型/运行时/配置/Prompt/Schema。Analyze、Repair 和每个实验 Variant 均在调用前记录 attempt。
- 记录 2026-08-14 真实 Research dry-run：两条获准 OpenAI 页面均返回 HTTP 403 JavaScript/Cookie challenge，系统在 Codex 前 fail-closed；未使用浏览器绕过，也未写正式 Research 输出。
- 最新一次受限 dry-run 在两条 canonical 403 后从 OpenAI 官方 RSS 成功取得 2/2 个 `feed_item`；首次 Analyze 因旧 answered/Claim 附加约束返回 `codex_output_invalid`，准确记录 calls=1，未运行实验或写正式产物。该附加约束已按 `gap_impact` 规则移除并完成离线回归，未重复真实 dry-run。
- 完成第二次获准的 2026-08-14 Research live dry-run：两条 canonical 各返回一次 403 后安全取得 2/2 个官方 RSS `feed_item`，Analyze 形成 2 条 partial Claim 和 answered / non-blocking partial / blocking unanswered 各 1 个答案，合法输出 `RESEARCH_INCOMPLETE`；未触发 Repair，baseline 与 structured 各成功运行一次、均为 6 pass / 2 fail，总计 3 次 Codex 调用。dry-run 未写正式 Research Pack、运行记录或报告，生产 Runtime 与 LaunchAgent 仍未激活。

- 将每日选题生产 Provider 改为本机已登录的 Codex CLI：非交互 `codex exec`、显式模型、严格 JSON Schema、只读 Sandbox、无人工审批、隔离临时目录、2 MiB 输出上限和最小子进程环境；OpenAI API 仅保留为可选备用。
- 将真实 Topic Selection 从 GitHub Actions 迁移到 Mac Local Runtime：新增 13:00—18:00 独立任务状态、最多 2 次尝试、Topic 数据 Git 白名单和 pending commit 恢复；PR/CI 不安装或 reload LaunchAgent。
- 删除 GitHub 真实模型定时 Workflow；PR Validation 继续只运行 Fixture，不访问 Codex 服务、OpenAI API、X、公众号、Chrome 或 Browser Bridge。
- 完成 2026-08-14 真实 Codex dry-run：常规环境以 1 次调用选择 92 分 Agent 任务验收单母题；`env -i` 精简环境也以 1 次调用完成合法 `NO_PUBLISH`。两次均未写正式输出、未改 Git、未访问平台。
- 加固每日选题离线正确性：跨日素材按最新快照确定性合并，RSS/AIHOT 共用 Cloud 预算，X 与两类微信预算独立，空 Cloud query 不再误触 8 条上限，并输出安全的 eligible/selected/drop 诊断。
- 统一 Product Claim 与 novelty evidence 真实解析，只有本次 fact source 或 ID 匹配的合法 evidence JSON 可以通过；虚构引用、txt、损坏/空 JSON、角色错误和路径穿越均拒绝。
- 无素材时在 Provider 创建前直接 `NO_PUBLISH`；损坏的当日 decision fail closed 且不覆盖；模型 timeout/网络错误和 judge/repair 调用数准确区分，候选及输出异常安全失败。
- 素材敏感扫描复用 Browser 文件类型感知语义，正常 Authorization/Cookie 技术说明可用，真实凭证、当前 home 与微信临时 URL 继续拒绝。
- 增加每日选题 v0：72 小时时窗、五种来源角色、restricted 隔离、确定性预筛选和最大 60 条 Material Cards。
- 增加最多 3 个候选、代码硬淘汰与六维重算、80 分门槛、证据 15/10/5 上限，以及单一 `SELECT_TOPIC` / `NO_PUBLISH` 决策。
- 从产品真相配置压缩 Product Context，代码执行模块/pillar 最小上限、CTA 交集降级与 Product Claim 真实 evidence reference 校验。
- 增加 30 天历史签名和 0.72 token 相似度检查、具体 novelty/evidence 解除条件与 input hash 幂等。
- 增加离线 Fixture 与 OpenAI Responses API 结构化输出 Provider；模型名必须由环境提供，结构修复最多一次，故障不伪装为 NO_PUBLISH。
- 增加严格 Topic Decision Zod / Draft 2020-12 JSON Schema、受限日报、CLI 和默认关闭的北京时间 13:00 Workflow；自动提交只有三类选题输出路径。

- 增加 `config/product.yaml` 产品真相源，结构化记录定位、用户转变、四个机制、两层学习架构、13 个交付模块、365/499 定价与证据边界。
- 增加 `config/content-fit.yaml` 策略假设，建立 8 个学习阶段、8 个内容 pillar、模块映射、交付状态适配分上限和 `none/light/club` CTA 规则。
- 增加严格 Zod 与 Draft 2020-12 产品/内容承接 JSON Schema、无缓存加载器、fail-closed Claim/模块 API 和 `npm run product:check`。
- 将产品知识库和内容策略升级到 v2，区分海报方向、当前交付、容器、部分交付与未知权益，并新增产品真相层维护文档。
- `config/project.yaml` 不再保存重复价格和简化产品权益，只引用产品/承接配置；内容比例改为按 pillar 的 `strategy_hypothesis`。
- PR CI 增加产品契约检查；全流程不调用模型、不访问真实平台、不修改 LaunchAgent，也不提交海报、照片或二维码截图。
- 将 Browser 数据敏感扫描改为文件类型感知：JSON/JSONL 必须逐条解析并递归检查敏感键、`content_path` 与真实路径值；Markdown 允许正常 Authorization/Cookie/ct0 说明、代码路径示例和占位凭证，只拦截明确真实值、当前 home 与微信临时访问 URL。
- 将公众号正文的临时参数检测限制到 `mp.weixin.qq.com` 和 `weixin.sogou.com`；外部域名的 `signature`、`sessionid` 等普通签名 URL 不再误报，微信与搜狗微信访问参数继续 fail closed。
- 以稳定 `material_id` 隔离公众号正文下载目录，避免同日同标题文章互相覆盖；正式 `content_path` 保持仓库相对 POSIX 路径，dry-run 为 `null`，命令摘要隐藏本机输出路径。
- 对 `origin/main..HEAD` 的每个 pending commit 强制校验提交标题、真实采集日期、Browser 路径白名单及 commit 时点文件内容；直接 push、rebase 前后都执行，非法或不可读提交以 `invalid_staged_paths` 停止。
- pending 恢复结果携带全部采集日期：同日恢复跳过重复采集，只恢复历史日期后继续当天健康检查和采集。
- 将共享健康项与平台探测隔离，X 和公众号独立探测、并行采集；单平台成功仍持久化并 Git 同步为 `partial_success`，仅双平台失败时整次为 `failed`。
- 加固公众号正文产物：`realpath` 限定 Runtime clone、拒绝路径/符号链接逃逸与非 Markdown 文件，正式素材只保存仓库相对 POSIX `content_path`，dry-run 路径保持 `null`。
- 清理公众号 Markdown 顶部临时“原文链接”，仅保留可追溯 canonical URL；签名型、来源型和裸 `/s` URL 即使正文下载成功也保持 unresolved/quarantined，正文中的普通 `signature` 不误报。
- 扩展 Browser 数据暂存扫描到结构化敏感字段和微信域名临时访问参数，并确保 Materials、Run Log 和命令摘要不持久化 Runtime clone 绝对路径。
- 增加 pending commit 与远端同时前进时的自动 rebase/push 恢复，以及首次 push 竞态的一次有界重试；冲突继续 abort 并保留本地 commit，不 force、不重新采集。
- 区分 manual 与 scheduled 触发：`local:morning` 可在窗口外执行一次，manual dry-run 始终健康检查和 Browser dry-run；scheduled 继续严格服从窗口。第二次失败只发送一次达到上限通知，后续同日轮询静默。
- 因用户主动降低账号与自动化风险的产品决策，将小红书从活跃采集、内容生产、发布、报告、查询配置和 Browser Pipeline 中移除；历史 Schema 与验证审计继续保留。
- 增加 X + 微信公众号 Mac 本机调度运行时：上海时区 07:30—12:00 due window、外部状态、原子锁、环境检查、Browser 日报和安全通知。
- 增加独立 Runtime clone、Browser 数据 Git 白名单、敏感内容扫描、pending commit 优先重试、rebase 冲突 abort 与禁止 force push 的同步逻辑。
- 增加 LaunchAgent 模板和默认 dry-run 的安装/卸载器；PR 与 CI 不安装生产 Agent，也不访问真实 Browser 平台。
- 在真实 Chrome Profile 下接通 OpenCLI Browser Bridge，并在线验证 X、小红书、公众号搜索与 5 篇正文下载；第一轮 dry-run 24/24 命令成功并产生 104 个 raw 行，旧输出未统计唯一数。
- 增加 Browser 素材稳定 identity、canonical URL、跨查询统一合并，以及平台和总计的 raw/unique/duplicate 统计；同日持久化不再覆盖先前查询来源。
- 增加 X 富搜索到内建基础搜索的受控 fallback；小红书 token URL 和公众号临时 tracking URL 不再持久化。
- 修复公众号相对时间以 Unix epoch 推断的问题，严格拒绝非法日历日期；dry-run 清理正文后不再返回失效 `content_path`。
- 保留 `docs/14` 首次 Bridge 未连接的历史报告，并将后续成功接通和第二轮修正迁移到 `docs/17`。
- 第二轮唯一一次真实 dry-run 得到 104 raw / 102 unique / 2 duplicate；X 为 80/78/2，小红书为 4/4/0，公众号为 20/20/0，4 篇正文通过最终解析。
- 最终离线补丁固定公众号跨运行 discovery identity 和搜索到正文的主 material identity，将不可追溯原文的搜狗候选隔离，并修复 X fallback product 与终端状态优先级；未再次访问真实平台。
- 合并前同步 Zod 与 Cloud/统一素材 JSON Schema，新增自动生成、漂移检查和 Ajv 2020 契约测试；公众号 inferred/unknown discovery identity 不再依赖任何动态时间，真实运行统计保持不变。
- 固定公众号 discovery identity 仅使用规范化标题与摘要，使 inferred/unknown 升级为 exact 时主 material ID 不变；精确发布时间保留为元数据，解析出的稳定文章身份继续作为 alias。
- 增加搜狗微信结果到公众号正文 URL 的只读解析适配器，支持相对时间和中文发布时间，并拒绝退出码为 0 的业务失败下载结果。
- 修复 X 富字段适配器的公共 Web bearer 发现：优先复用当前 OpenCLI 版本集中维护的公共 token，页面扫描仅作后备。
- 增加已真实验证的 RSS / AIHOT v1 Cloud Collector；它是当前唯一正式每日运行通道。
- 增加 X、小红书、公众号 OpenCLI Browser Collector 基础架构，并在本次从 `experimental_manual_only` 升级为 `verified_live_manual`。
- 增加本地只读 Twitter 富互动适配器、安装脚本、平台预算和查询轮换。
- 扩展统一素材字段，缺失互动数据保持 `null`，小红书推断日期显式标记。
- 首次 RSS 启动只落最近 7 天素材，旧内容只写指纹，未知日期进入隔离区。
- 修复英文短关键词边界、重复关键词加分和单条异常隔离。
- 增加 PR CI、UGC 原创政策、实时能力报告和双通道运行文档。
- 修复 Browser CLI 状态到退出码的映射：成功/部分成功为 0，完整失败为 2，参数或程序错误为 1。
- 将 AIHOT User-Agent 改为项目自身身份；可选 Actor 仅接受 UUID v4，缺失或非法配置不阻断采集。
- 记录 Codex Browser 的 `exploration_only` 真实能力边界，不接入正式 Browser Pipeline。

## 0.2.0 — 2026-08-12

- 增加 Node.js 20 + TypeScript 每日素材采集管线。
- 增加 7 个经真实请求和解析核验的 RSS / Atom 来源。
- 增加 URL 规范化、双 SHA-256 指纹、同日与跨天去重。
- 增加确定性可信度、新鲜度和用户相关度评分。
- 增加 JSONL 素材、运行日志、状态文件和每日 Markdown 报告。
- 增加定时与手动 GitHub Actions，只在输出变化时自动提交。
- 增加离线 fixture 与 URL、指纹、去重、评分、失败隔离、幂等和日报测试。
- 将路线从批量生成 20 个选题修正为支持 `NO_PUBLISH` 的每日自主循环。

## 0.1.0 — 2026-08-12

- 初始化项目仓库结构。
- 建立账号定位、人物事实与观点库。
- 建立「AI 不掉队俱乐部」产品知识库。
- 建立选题、内容、真实性、质量和平台规则。
- 建立 MVP 系统架构、数据模型和实施路线。
- 增加素材、选题、研究、写作、改写、审核和发布包提示词。
- 增加证据卡、实验记录、内容简报和发布包模板。
- 增加可机器读取的项目配置与 JSON Schema。
