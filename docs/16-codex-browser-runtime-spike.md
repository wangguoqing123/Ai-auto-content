---
title: Codex 浏览器采集运行时真实验证报告
version: 1.0.0
updated_at: 2026-08-12
status: live_checked
recommendation: use_for_exploration_only
---

# Codex 浏览器采集运行时真实验证报告

## 结论摘要

本轮在 macOS 当前环境真实发现并使用了两个 OpenAI 浏览器控制插件：

1. `Browser` / `browser:control-in-app-browser`：Codex In-app Browser，运行时类型为 `iab`，使用独立于日常 Chrome 的浏览器会话。
2. `Chrome` / `chrome:control-chrome`：通过 Chrome 扩展连接用户日常 Chrome，运行时类型为 `extension`，Profile 名为“您的 Chrome”。

控制层提供一个受限的 Playwright 风格 API，用于标签页、DOM、点击、输入、截图和只读页面求值；本轮实际浏览器列表中没有 `cdp` 类型实例，也没有 Network 请求/响应订阅接口。

推荐结论：`use_for_exploration_only`。

直接原因：Chrome 扩展路径能复用小红书登录态并真实结构化读取 DOM，但当前没有 Network 面板能力；X 未登录；微信公众号正文被站点安全策略阻止；`codex exec` 无交互实测中，浏览器访问需要用户许可且失败后进程仍返回退出码 0，不能组成可靠的 `launchd -> JSON -> 退出码` 日采集链路。

## 1. 验证范围与安全边界

| 项目 | 实际值 |
|---|---|
| 完成时间 | 2026-08-12 22:42 CST |
| 仓库分支 | `feat/daily-material-collector-v0` |
| 测试起点 | `76e8a290b529fb281dbfce9354fb8fe9f776bc1a` |
| Codex CLI | `codex-cli 0.147.0` |
| 浏览器插件 | Browser 26.803.61601；Chrome 26.803.61601 |
| 数据操作 | 只读 |
| OpenCLI | 未调用；现有 OpenCLI Collector 未修改 |

本轮没有点赞、评论、关注、发布、私信、下载 Cookie、输出认证值、绕过验证码、绕过登录墙或绕过站点安全策略。搜索结果中的临时访问参数没有写入报告；不能安全保留的链接字段写为 `null`。所有自动化测试标签页已关闭，没有退出用户账号。

## 2. 当前浏览器能力实测

| 验证项 | 实际结果 | 证据/边界 |
|---|---|---|
| 1. 浏览器类型 | 两种：Codex In-app Browser (`iab`)；Chrome 扩展 (`extension`) | 实际 `browsers.list()` 只返回这两类；没有 `cdp` 实例。页面控制使用插件提供的 Playwright 风格子集，不是仓库自行启动的 Playwright。 |
| 2. 使用已有 Chrome Profile | 是 | Chrome 元数据显示 Profile 为“您的 Chrome”，并能读取其中已登录的小红书。 |
| 3. 独立 Profile | 是，限 In-app Browser | In-app Browser 是独立 `iab` 会话；X 在它和 Chrome 中都未登录。 |
| 4. 登录态持久化 | 在本轮规定的“关闭测试标签页 + 重置浏览器运行时”范围内成立 | 重置前后扩展实例一致；小红书均为已登录，X 均为未登录。没有退出或重启用户 Chrome 进程，也没有重启 Codex Desktop 进程。 |
| 5. 无人工聊天触发 | `semi_automated` | `codex exec` 可无交互启动，但浏览器访问许可在无交互模式中被拒；不能完成采集。 |
| 6. 结构化数据 | 支持 | DOM 求值和定位器能直接返回对象/数组；本轮已获得小红书与搜狗搜索的结构化结果。 |
| 7. Network 请求 | 不支持当前任务所需能力 | API 仅暴露 console logs；没有请求列表、响应体、HAR 或 Network 事件。页面只读求值中 `performance` 也不可用。 |
| 8. 多标签页 | 支持 | 同一 Chrome 会话同时创建并控制 X、小红书、搜狗微信等多个标签页；可列出、关闭和 finalize。 |
| 9. 超时、取消、失败状态 | 部分支持 | 定位器 150 ms 超时真实抛出 `Playwright selector deadline exceeded`；API 未暴露任务级取消信号；CLI 浏览器失败后仍可能退出码 0。 |
| 10. macOS launchd | 当前不可可靠运行 | `launchd` 可启动 `codex exec`，但浏览器许可、桌面/扩展在线状态和退出码语义不满足无人值守要求。 |

## 3. X 真实验证

### 登录与性能

| 浏览器 | 首次加载 | 登录状态 | 页面结果 |
|---|---:|---|---|
| Chrome 扩展 | 6,636 ms | `login_required` | `https://x.com/home` 重定向到登录页 |
| Codex In-app Browser | 5,469 ms | `login_required` | 同样重定向到登录页 |
| Chrome 重置后复测 | 5,041 ms | `login_required` | 登录墙仍存在 |

出现登录墙后立即停止 X，没有尝试绕过登录。

### 两个查询

| 查询 | 实际条数 | 状态 | 搜索耗时 |
|---|---:|---|---:|
| `AI工具 lang:zh -filter:replies -filter:nativeretweets` | 0 | `login_required` | `null` |
| `AI workflow lang:en -filter:replies -filter:nativeretweets` | 0 | `login_required` | `null` |

这里的 0 表示登录墙前没有执行搜索，不表示查询结果为空。没有生成虚构 tweet 记录。

| 目标字段 | 实际值 |
|---|---|
| tweet id | `null` |
| 作者 | `null` |
| 作者粉丝数 | `null` |
| 正文 | `null` |
| 发布时间 | `null` |
| 点赞 | `null` |
| 转发 | `null` |
| 回复 | `null` |
| 引用 | `null` |
| 收藏 | `null` |
| 浏览量 | `null` |
| 原始链接 | `null` |
| 媒体信息 | `null` |

### X Network 结果

- `SearchTimeline` 或等价请求：`null`。
- 原因：X 搜索未执行，且当前插件没有 Network 请求列表/响应体接口。
- 不根据页面脚本、猜测接口名或其他数据源补值。

## 4. 小红书真实验证

### 登录与搜索性能

- Chrome Profile 已登录：页面出现通知、消息和“我”，没有登录墙。
- 首次首页加载：7,474 ms。
- `AI工具` 搜索：4,686 ms，取得 10 条。
- `AI编程` 搜索：4,332 ms，取得 10 条。
- 没有验证码、安全验证或风险控制。

搜索结果在测试过程中会动态变化；以下是首次成功读取时的有界快照。原始链接只保留不含临时访问参数的 canonical URL。

### 搜索：AI工具

| 排名 | 标题 | 作者 | 点赞 | 发布时间 | 原始链接 |
|---:|---|---|---:|---|---|
| 1 | 8个WorkBuddy入门装的skill | 小丫AI笔记 | 7 | 1天前 | https://www.xiaohongshu.com/explore/6a79ce9900000000280071c6 |
| 2 | 用ChatCut剪了一周片子 | 量子位 | 212 | 07-31 | https://www.xiaohongshu.com/explore/6a6c13ea000000000502b297 |
| 3 | 有了AI以后，再也不用手工剪辑了 | 智润 Jeremy | 371 | 2天前 | https://www.xiaohongshu.com/explore/6a78fc2900000000250062cb |
| 4 | AI新手村 \| 掌握这三步，AI真能替你剪视频了 | H船长 | 952 | 07-22 | https://www.xiaohongshu.com/explore/6a6086b7000000000503af0b |
| 5 | 创意类AI工具实操讲透！ | 搞AI的贝卡 | 2.7万 | 6天前 | https://www.xiaohongshu.com/explore/6a74640b00000000050216c5 |
| 6 | 普通人学什么AI工具？9种场景18个AI工具！ | 未来设计师KiK | 809 | 05-17 | https://www.xiaohongshu.com/explore/6a099ed2000000003700ea82 |
| 7 | 熬夜肝完，呼声超高的AI热点.Skill来了！！ | 数字生命卡兹克 | 3814 | 05-08 | https://www.xiaohongshu.com/explore/69fd6b6c000000002301ff4a |
| 8 | 8种让AI光速出图改图的必学技巧！ | 托尼三三 | 1.1万 | 03-04 | https://www.xiaohongshu.com/explore/69a7ebf9000000001a0268f6 |
| 9 | 用Codex做装修，搞定室内设计全流程！ | 汤姆喵喵 | 1426 | 08-01 | https://www.xiaohongshu.com/explore/6a6ce8b6000000003300a76c |
| 10 | Claude和Codex怎么一起用？ | 昭小昭（AI版） | 1.6万 | 1天前 | https://www.xiaohongshu.com/explore/6a7082bf0000000028030b41 |

### 搜索：AI编程

| 排名 | 标题 | 作者 | 点赞 | 发布时间 | 原始链接 |
|---:|---|---|---:|---|---|
| 1 | 不会编程的老婆，做出日访70万爆款网站 | 泽卿聊AI | 1.2万 | 07-27 | https://www.xiaohongshu.com/explore/6a604816000000001d020d3b |
| 2 | 拯救你AI审美的5个宝藏网站❗️打破信息差 | AI教练振轩 | 7799 | 07-28 | https://www.xiaohongshu.com/explore/6a6821f600000000090369c3 |
| 3 | 新手小白快速入门AI编程vibecoding | 喜欢编程的杨同学 | 1509 | 04-24 | https://www.xiaohongshu.com/explore/69eb6254000000001a02e649 |
| 4 | 本周爆火开源项目，建议先收藏 \| 7月第三周 | Oraink灵砚 | 9375 | 07-27 | https://www.xiaohongshu.com/explore/6a662f9d000000001003ffb6 |
| 5 | 下班后 4h，AI帮我组建了一支搞💰小分队 | 西门聪明蛋 | 1815 | 06-30 | https://www.xiaohongshu.com/explore/6a4388f8000000001101412f |
| 6 | Codex有多强？看完你也能用AI为所欲为 | 里昂说AI | 2.1万 | 05-29 | https://www.xiaohongshu.com/explore/6a19804b0000000006022810 |
| 7 | GPT5.6省钱秘籍：让Sol当领导 Luna Max牛马 | 汐汐的数码日记 | 601 | 08-04 | https://www.xiaohongshu.com/explore/6a70c81100000000080105c4 |
| 8 | 为了不让AI瞎写代码，大神把自己蒸馏了 | 量子位 | 1.3万 | 05-11 | https://www.xiaohongshu.com/explore/69ff126f000000003703538d |
| 9 | 文科生学AI：如何系统性搭建AI学习系统？ | 大浪妮卡Nika（裸辞上岸版） | 3945 | 07-10 | https://www.xiaohongshu.com/explore/6a50674c000000001702e254 |
| 10 | 10秒知道！这6类AI工具的专业版和平替版！ | 石臻说AI | 2.8万 | 04-23 | https://www.xiaohongshu.com/explore/69ea0293000000001f031803 |

### 详情：全局 2 篇

| 字段 | 候选 1 | 候选 2 |
|---|---|---|
| 详情耗时 | 6,659 ms | 6,809 ms |
| 标题 | 10秒知道！这6类AI工具的专业版和平替版！ | Claude和Codex怎么一起用？ |
| 作者 | 石臻说AI | 昭小昭（AI版） |
| 正文 | 分别涵盖AI编程，AI设计，AI音乐，AI生图，AI知识库，办公agent! | `null`（可见描述区只有标签） |
| 点赞 | 2.8万 | 1.7万 |
| 收藏 | 3.9万 | 2.4万 |
| 评论数 | 120 | 187 |
| 标签 | #AI工具、#AI新手村、#宝藏工具、#网站推荐、#自媒体工具、#效率神器、#创作者必备、#免费学习、#AI学习、#办公软件 | #AI工具、#人工智能、#ai、#claudecode、#codex、#vibecoding、#AI新手村、#AI教程、#AI邪修howto、#AI无限公司 |
| 原始链接 | https://www.xiaohongshu.com/explore/69ea0293000000001f031803 | https://www.xiaohongshu.com/explore/6a7082bf0000000028030b41 |

候选 2 的搜索卡在首次读取时显示 1.6 万点赞，打开详情时显示 1.7 万；报告保留两个真实时间点，不相互覆盖。测试还确认：不带搜索页临时访问参数直接打开某些 canonical URL 会返回 404，因此 canonical URL 不能当作稳定的无人值守详情入口。

### 评论：全局最多 10 条

只读取候选 1 当前已展开可见的前 10 条；候选 2 不再读取评论。

| # | 作者 | 评论正文 | 评论点赞 | 评论时间 | 是否回复 | 回复对象 |
|---:|---|---|---:|---|---|---|
| 1 | 朝花暮子栖 | Cursor原来要钱吗？ | 12 | 04-24广东 | false | `null` |
| 2 | momo | 它免费额度挺少的 | 4 | 04-24浙江 | true | 朝花暮子栖 |
| 3 | Zen Denim | 原来obsidian是免费的我一直以为要💰 | 4 | 04-23浙江 | false | `null` |
| 4 | 颜控 | 同步要钱的 | 2 | 04-24湖北 | true | Zen Denim |
| 5 | 一介粗羊咩老师 | copilot已经开始收紧啦，我的订阅都不让我订，直接refund我。 | 7 | 04-24江苏 | false | `null` |
| 6 | 惹事还怕事 | pro+用opus一个问题一块四，rules写了必须调ask-user还总不记得，真用不起了 | `null` | 04-25天津 | true | 一介粗羊咩老师 |
| 7 | 阿佘的日记 | 大神，软件测试工程师用啥呀 | 3 | 04-25安徽 | false | `null` |
| 8 | 石臻说AI | claude code | 15 | 04-25浙江 | true | 阿佘的日记 |
| 9 | 月亮大人 | mark一下，正好要学obsidian | 4 | 04-23浙江 | false | `null` |
| 10 | 硅基旅人 | Obsidian 亲测好用，用来当作本地知识库超好用 | 10 | 04-23浙江 | true | 月亮大人 |

### 小红书 Network 与数据来源

| 数据 | 本轮取得方式 | 是否能证明来自接口 |
|---|---|---|
| 搜索排名、标题、作者、点赞、发布时间、链接 | 渲染后的 DOM | 否；Network 不可见 |
| 详情标题、作者、正文、点赞、收藏、评论数、标签 | 渲染后的 DOM | 否；Network 不可见 |
| 评论及楼中楼关系 | 渲染后的 `.comment-item` 结构 | 否；Network 不可见 |

页面包含 `window.__INITIAL_STATE__` 脚本，但本轮不读取或持久化其中的账户/访问参数；这不能替代 Network 请求验证。当前插件无法列出具体接口 URL 或响应体，因此接口来源统一记为 `unverified`，不是根据经验猜测。

## 5. 微信公众号真实验证

### 搜狗微信搜索

搜狗微信搜索无需登录，两个关键词都正常返回第一页，没有验证码或异常访问提示。

| 关键词 | 搜索耗时 | 实际条数 |
|---|---:|---:|
| AI工具 | 4,294 ms | 10 |
| AI编程 | 3,132 ms | 9 |

搜狗搜索页只提供带临时访问参数的跳转 URL。为遵守“不输出访问值”的安全规则，下面的 `文章链接` 统一为 `null`；这也是该字段在安全持久化时的真实缺失状态。

#### AI工具

| 排名 | 标题 | 公众号名称 | 摘要 | 发布时间 | 文章链接 |
|---:|---|---|---|---|---|
| 1 | 游戏交易平台横评、AI 流量变革、办公工具迭代三大行业热点观察 | 讯科社 | 作者:林砚舟 媒体号:知讯社 编辑:苏景然互联网行业正在游戏交易、网络流量结构、AI 办公工具三大赛道同步发生变化.手游衍生... | 1小时前 | `null` |
| 2 | 今年考研作文好消息!大作文预测:AI工具,双图表,作文模板 | 考研军火库 | AI tools(AI工具)注:必须用复数形式,泛指一类事物.左图(动态图):事物:the user base 或 the number of users(用户规模)右图... | 3小时前 | `null` |
| 3 | 依靠 AI 编程工具 “手搓” 开发出一款实用工具 App, | 知音体 | 近日,一则独立开发者的创业案例引发行业热议,一名没有编程基础的普通男子,依靠 AI 编程工具 “手搓” 开发出一款实用工具 App... | 1小时前 | `null` |
| 4 | AI工具越多,为什么反而越难选? | 玉米AI随想录 | AI工具,我到底该用哪个?6.02亿我国生成式人工智能用户规模42.8%生成式人工智能普及率748款已备案生成式人工智能服务来源:... | 1小时前 | `null` |
| 5 | AI工具越来越多,我为什么反而只用几个? | 能叔叔 多元尝试 | 这或许也是我现在面对AI工具越来越多时的一种态度:保持关注,但不追逐;保持好奇,但不焦虑.乔布斯曾经谈到“专注”时强调,... | 1小时前 | `null` |
| 6 | 深度报告\|AI工具出错后,为什么不能只会重试? | 起号手册 | 崇明AI十三问 · 深度报告深度报告\|AI工具出错后,为什么不能只会重试?一个会调用搜索、数据库、邮件、日历、云服务和文件系统... | 2小时前 | `null` |
| 7 | 你可以不会任何AI工具,但不能不会Workbudd | 美美子May | 你可以不会任何AI工具,但不能不会Workbuddy,作为国内最强Agent,他能给你解决太多应用场景!一天的 WorkBuddy 闭门会圆满结... | 7分钟前 | `null` |
| 8 | 每天加班到10点?我用这2个AI工具,把下班时间提前了2小时 | 赫同学AI | 直到把两个AI工具真正用顺了手:WorkBuddy 和 Codex.一个管“办公杂活”,一个管“写代码”,配合起来,我每天至少能抢回 2 ... | 6分钟前 | `null` |
| 9 | 8月12日,AI工具开始接管旧工作流 | 用Ai重启第二人生的老林 | 今天值得你理的只有 4 件事:换 AI 工具不用重新搬家了;AI 视频开始拍多人长镜头;做智能体先画流程再写提示词;一直点允许不等... | 38分钟前 | `null` |
| 10 | 工作中的AI:战略比工具更重要 | 199IT互联网数据中心 | 相比单纯部署AI工具,组织层面的系统性变革正在成为企业价值创造的新分水岭.报告将企业AI战略划分为Deploy、Reshape和Invent... | 1小时前 | `null` |

#### AI编程

| 排名 | 标题 | 公众号名称 | 摘要 | 发布时间 | 文章链接 |
|---:|---|---|---|---|---|
| 1 | AI编程:5种最流行的人工智能编程语言 | 21CTO | Python 语法简洁,功能强大...C++ 优点 C++是世界最快的计算机语言,它提供了最快的执行时间和响应时间...Java 也是一种多范式语言,遵循面向对象开发与一次写入读取... | 2018-2-16 | `null` |
| 2 | AI编程的几点思考 | 海洋Talk | 六、技术平权对非技术人员而言,AI编程的最大意义不是“人人都能创业做产品”——虽然这确实在发生——而是一个更安静但更深远... | 2026-3-27 | `null` |
| 3 | AI编程,离企业级软件开发还有多远? | 行云创新 | 2026年,科技圈最火的词是什么?AI编程,一定榜上有名.从OpenAI发布GPT-5.3-Codex,到Anthropic推出Claude Code 2.1,从... | 2026-3-19 | `null` |
| 4 | AI编程卷疯了!算法工程师,真要被取代?(附实操建议) | 计算机视觉life | 一、先认清:AI到底替代了什么?别自己吓自己先给大家吃颗定心丸:现在的AI编程工具,再厉害也有边界,它替代的,大部分是“不... | 2026-3-24 | `null` |
| 5 | 真“人工”智能,假AI编程! | LearnAndRecord | 获得了近3000万美元融资后被曝出,但实际上是真实的工程师在人工编程;只是借人工智能的宣传来吸引客户和投资.This AI startup ... | 2019-8-18 | `null` |
| 6 | AI编程进中小学课程:教育部今年起评测2万学生信息素养 | 新智元 | 文件强调在中小学阶段设置AI相关课程,娃娃们也要开始编程了.评测2万中小学生信息素养,AI课程也要学教育部本月13日印发的《... | 2019-3-15 | `null` |
| 7 | AI编程末日 | 陈健 | 第一章 · 断裂2040年3月15日,全球所有AI编程系统在同一秒钟停止了运作.没有征兆,没有预警,没有任何一个监控仪表盘亮起红... | 2026-3-20 | `null` |
| 8 | AI编程神器Copilot治好了我的精神内耗 | AI前线 | 整理 \| 凌敏、核子可乐 转眼间,AI 编程神器 Copilot 已经发布一年有余,这一年,Copilot 改变了什么?真的给开发者带来帮助了吗? ... | 2022-9-16 | `null` |
| 9 | 用AI编程会导致代码泄露吗? | 摩根有话说 | 担心代码泄露,前提是有代码可泄露吧,AI抠腚之后都不写代码了,泄露啥?最近我看到一个梗图,一款Anthropic牌的“AI Coding专... | 2026-3-30 | `null` |

### 公众号文章详情

从搜索结果打开第 1 篇文章时，浏览器在跳转到 `https://mp.weixin.qq.com/s` 阶段被当前站点安全策略拒绝。按规则立即停止，没有尝试第 2 篇、其他浏览器、CDP 或任何绕过方式。

| 字段 | 实际值 |
|---|---|
| 标题 | `null` |
| 公众号名称 | `null` |
| 发布时间 | `null` |
| 正文 | `null` |
| 原始链接 | `null` |
| 阅读量 | `null` |
| 在看 | `null` |
| 转发 | `null` |
| 收藏 | `null` |

搜狗搜索排名只表示当前搜索排序，不推断阅读量或爆款。

## 6. 登录态与 Session 持久化

持久化步骤完全按本轮要求执行：记录类型，关闭所有测试标签页，清空并重新初始化浏览器控制运行时，再访问 X 和小红书。

| 项目 | 重置前 | 重置后 | 结论 |
|---|---|---|---|
| Chrome 类型 | `extension` | `extension` | 一致 |
| Chrome Profile | “您的 Chrome” | “您的 Chrome” | 一致 |
| 扩展实例 | 已连接 | 同一个扩展实例 | 一致 |
| X | 未登录 | 未登录 | 状态保留，但没有可用登录态 |
| 小红书 | 已登录 | 已登录，首页 feed 正常 | 登录态保留 |
| In-app Browser | 独立 `iab` 会话 | 未用账号状态复测 | 不与 Chrome 共用登录态 |

测试证明的是标签页关闭和 Codex 浏览器运行时重置后的持久化。没有主动退出账号，也没有关闭用户 Chrome 或重启 Codex Desktop，因此不把“完整应用/系统重启后”写成已实测事实。

## 7. 无人值守能力实测

### 可调用入口

| 入口 | 当前存在 | 能否完成浏览器采集 |
|---|---|---|
| Codex CLI `codex exec` | 是，支持非交互、JSONL、临时会话、只读 sandbox | 不能可靠完成 |
| MCP | `node_repl` 已启用；浏览器客户端依赖该会话 | 只在拥有可用浏览器 backend 的 Codex 任务中成立 |
| 本地 HTTP 服务 | 没有发现浏览器专用、稳定的本地 HTTP 采集 API | 否 |
| 可执行脚本 | 浏览器插件有内部 `browser-client.mjs`，不是独立采集 CLI | 否 |
| 无交互任务模式 | `codex exec` 可启动 | 浏览器许可阻断，且失败可返回退出码 0 |

### 两次 `codex exec` 实测

1. In-app Browser：无交互进程启动成功，但返回 `Browser is not available: iab`；最终 JSON 为 `status: unavailable`，进程退出码为 0。
2. Chrome：无交互进程成功连接同一个 Chrome 扩展实例；访问 `example.com` 时因缺少用户许可被拒，最终 JSON 为 `status: unavailable`，进程退出码仍为 0。

因此当前分类为：`semi_automated`。

目标链路的实测判断：

```text
macOS launchd
  -> 可以启动 codex exec
  -> 可以加载 Chrome 插件并连接扩展
  -> 站点访问许可可能要求人工参与并阻断
  -> 可以输出 JSONL，但浏览器失败不保证非零退出码
  -> 不能作为可靠无人值守采集任务
```

本轮没有创建 launchd 配置。

## 8. 性能与每日运行判断

| 平台 | 登录状态 | 首次加载 | 搜索耗时 | 详情耗时 | 评论读取 | 实际条数 | 实际字段 | 缺失字段 | 限制 | 适合每天运行 |
|---|---|---:|---:|---:|---:|---:|---|---|---|---|
| X | 未登录 | Chrome 6,636 ms；IAB 5,469 ms | `null` | `null` | `null` | 0 | 无 | 全部目标字段 | 登录墙 | 否 |
| 小红书 | 已登录 | 7,474 ms | 4,686 / 4,332 ms | 6,659 / 6,809 ms | 约 100 ms（详情加载后 DOM 读取） | 20 搜索 + 2 详情 + 10 评论 | 所有指定搜索字段；详情除候选 2 正文外；全部评论字段 | 候选 2 正文 `null`；接口来源 `unverified` | 无验证码；canonical 详情链接不稳定 | 否，当前仅适合人工探索 |
| 公众号 | 搜索无需登录 | 4,294 ms | 4,294 / 3,132 ms | `null`（跳转被拒） | `null` | 19 搜索 + 0 详情 | 标题、公众号、摘要、发布时间、排名 | 安全可持久链接和所有详情/互动字段 | `mp.weixin.qq.com/s` 站点安全策略 | 否 |

## 9. Network API 发现结果

| 平台 | Network 能力 | 发现的接口 | 可确认的数据来源 |
|---|---|---|---|
| X | 不可用；且未通过登录墙 | `null` | 无 |
| 小红书 | 不可用 | `null` | 全部实值来自 DOM |
| 搜狗微信 | 不可用 | `null` | 搜索实值来自服务端渲染/渲染后 DOM；无法进一步验证接口层 |
| 微信文章 | 跳转前被安全策略阻止 | `null` | 无 |

当前插件的 `tab.dev` 只有 console logs，没有 Network 请求、响应体、HAR、请求拦截或 GraphQL payload。虽然 Codex CLI feature 列表中存在浏览器/CDP 相关 feature flag，当前实际 `browsers.list()` 没有 `cdp` 实例，受支持 API 也没有 Network 表面；不能据此把 CDP 或 Network 写成可用。

## 10. 与现有 OpenCLI 的对比

| 维度 | Codex Browser / Chrome | 现有 OpenCLI Collector |
|---|---|---|
| 当前在线连接 | Chrome 扩展已连接；In-app Browser 在桌面任务内可用 | daemon 正常，但 Browser Bridge 未连接 |
| 复用 Chrome Profile | 已实测可以，小红书登录态可用 | 设计上依赖 Chrome Profile；当前 Bridge 阻断，未在线验证 |
| 结构化输出 | 可由 Codex 对 DOM 编写一次性提取逻辑 | 已有固定 CLI JSON schema、解析器和统一素材映射 |
| X 富字段 | 本轮登录墙，全部 `null`；无 Network | `search-rich` 已声明富字段，但在线数据仍未验证 |
| 小红书 | 已真实取得 20 搜索、2 详情、10 评论 | schema/Fixture 已验证，在线取数被 Bridge 阻断 |
| 公众号 | 搜狗搜索真实可用；微信正文被站点策略阻止 | 搜索/下载 schema 与 Fixture 已验证，在线取数被 Bridge 阻断 |
| Network | 当前 API 不暴露 | 适配器目标包含 X GraphQL 等浏览器请求路径 |
| 超时 | 定位器/导航支持局部超时 | Runner 有统一进程超时并终止子进程 |
| 取消 | 没有暴露任务级 `AbortSignal` | Runner 已实现 `AbortSignal`、SIGTERM/SIGKILL |
| 失败状态 | 工具调用有失败；`codex exec` 仍可能退出码 0，需要解析最终 JSON | Runner 显式区分 success/login_required/blocked/unavailable/command_failed |
| launchd | 当前需人工许可，不能可靠无人值守 | CLI 形态适合调度，但必须先修复 Browser Bridge |
| 维护方式 | 依赖模型动态理解 DOM，页面变化后需要重新探索 | 依赖适配器和解析器维护，行为更确定、可测试 |

Codex 浏览器解决了“当前 Chrome 可以真实打开并读到小红书”的探索问题，但没有解决项目最关键的无人值守、Network、稳定 schema、退出码和安全跳转问题，因此不能替换 OpenCLI，也不应绑定进正式业务逻辑。

## 11. 推荐结论

`use_for_exploration_only`

适用范围：人工发起的只读页面探索、DOM 字段确认、登录态诊断和适配器开发前的页面结构研究。

不适用范围：每日 launchd 采集、稳定生产 JSON、依赖 Network payload 的 X 富字段采集、微信公众号正文批量读取，以及需要可靠取消/退出码的任务。

## 12. 唯一仍需用户完成的操作

如要补齐 X 的真实字段验证，请在 Chrome 扩展当前连接的“您的 Chrome” Profile 中正常登录 X，然后只重跑本报告的两条 X 查询。不要导出 Cookie，也不要处理或绕过任何验证码/安全验证。
