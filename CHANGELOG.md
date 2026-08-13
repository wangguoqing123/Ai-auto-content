# Changelog

## Unreleased

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
