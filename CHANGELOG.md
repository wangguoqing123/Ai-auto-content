# Changelog

## Unreleased

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
