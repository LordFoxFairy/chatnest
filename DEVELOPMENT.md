# Research：当前实现与维护边界

## 一个底座，不拼三套 Agent

直接改造官方 `vercel/chatbot`，保留 Next.js、AI SDK 的流式会话、认证、历史、模型选择和文档产物能力。基础版本为 `c2f8235e1f3ea903ad8b7f61447c4f74164b5c58`；不是 Codex 桌面端源码，也没有引入 OpenCode 或 LibreChat。

产品是 Chat Agent。用户给目标，模型决定下一步并使用实际可用能力；知识产权调查是一项 Skill，不是写死在后端的搜索→审核流水线。

| 层 | 职责 | 主要位置 |
| --- | --- | --- |
| 会话运行 | 官方多步工具循环、流式输出、步骤/时间限制、取消、历史 | `app/(chat)/api/chat/route.ts` |
| Skills | 业务方法与参考材料；先展示元数据，相关任务才加载正文 | `skills/`、`lib/agent/skills.ts` |
| 执行工具 | 官方 MCP 客户端发现现成工具；服务端白名单与确认策略 | `lib/agent/runtime.ts`、`config/agent.json` |
| 展示 | 对话、真实工具状态、确认按钮、实际返回来源、能力配置 | `components/chat/` |

只新增 `loadSkill`、`readSkillResource` 两个通用技能读取工具。搜索和网页正文提取默认接 Exa 现成 MCP，也保留可选 Tavily MCP。调查中的内容比较由模型遵循 Skill 完成。保留官方文档编辑工具用于报告，未向 Agent 开放天气工具。

## 本地运行

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate
corepack pnpm dev --hostname 127.0.0.1 --port 3000
```

先在 `.env.local` 配置 `AUTH_SECRET`、`POSTGRES_URL`。本次已建立仅绑定本机 `127.0.0.1:55432` 的独立 PostgreSQL 容器 `ip-agent-postgres`，数据在 `ip-agent-postgres-data` 卷中；没有使用或修改其他容器。已创建的 `.env.local` 被 Git 忽略，不应提交或发到聊天中。

模型支持两种接法：直连 OpenAI / 兼容接口时，在现有 `.env.local` 填 `MODEL_PROVIDER=openai`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`；地址是 API 根地址，例如 `https://api.openai.com/v1`，不包括 `/chat/completions` 或 `/responses`，模型名使用服务商提供的原始 ID。默认 `OPENAI_API_MODE=chat` 使用 Chat Completions；服务支持 Responses 时可设 `responses`。聊天、流式回复、标题、文档生成均复用同一连接，不需要 Vercel Gateway Key。直连模式只列出配置的模型，工具能力默认开启、图片能力默认关闭；按模型实际能力设置 `OPENAI_MODEL_TOOLS=0` 或 `OPENAI_MODEL_VISION=1`，这些是能力声明，不是连接验证。

另一种是 `MODEL_PROVIDER=gateway`，仅此时需 `AI_GATEWAY_API_KEY` 或 Vercel OIDC；这是 Vercel 的密钥，不是 OpenAI 的密钥。未指定 provider 时，只要存在 OpenAI Key/地址/模型配置便选择直连，否则保留上游 Gateway。默认 Exa MCP `https://mcp.exa.ai/mcp` 提供免密钥、限流的免费搜索和网页读取，仅开放 `web_search_exa` 和 `web_fetch_exa`。用量受服务方限制，并非无限或可用性保证；限流和工具错误会显示失败。可选 Tavily 需 `TAVILY_API_KEY`，缺密钥不连接。图片上传另需 `BLOB_READ_WRITE_TOKEN`，目前仅 JPEG/PNG。未配模型时明确报配置错误。界面的“已配置”不等于“连接成功”。[Exa 官方说明](https://exa.ai/docs/get-started/exa-mcp)。

默认每轮最多 12 个模型步骤、240 秒；工具执行时限 30 秒，单次模型输出上限 8000 token。它们是运行边界，不是准确的总费用上限，也不是后台持久任务。

单条用户消息最多 32,000 字符，支持贴入原文片段；接近上限时显示字数，超过上限提示并保留草稿，不静默截断。仅图片的消息也可提交，使用 SDK 的标准 filename 字段。图片限 JPEG/PNG、每张 5 MB、每轮最多 15 张；缺少存储时禁用上传并说明原因，服务端也明确返回配置错误。尚无实际存储凭据验收。

## 扩展方式

新增领域方法：添加 `skills/<name>/SKILL.md`，frontmatter 的 name 与目录一致，description 说明适用场景。参考文件放同目录下的 `references/`，按需读取；单个文件上限 64 KB，阻止目录穿越和逃逸符号链接。部署者维护技能包，聊天用户不能上传技能来修改服务端规则。

可选 `metadata.display-name` 和 `metadata.short-description` 用于用户可读的名称与用途；Agent 仍按原始 skill name 加载。加载成功显示“方法已就绪”，不代表调查已经完成。原始指令和参数收进工具卡“技术详情”。

新增执行能力：优先在 `config/agent.json` 配置现成 HTTPS MCP 服务、真实工具名称、服务端环境变量引用、允许工具列表。工具统一命名为 `<server-id>__<remote-tool-name>`。未明确自动批准的工具需要用户确认；客户端只能回应数据库中已有的确认请求，不能借确认覆盖工具名称、参数或输出。不要用自动批准列表开放删除、投诉、联系第三方等外部写操作。

Skills 不能凭空赋予文件、联网或脚本执行权限。当前支持指令和文本参考，不执行技能脚本。网页与工具正文被视为不可信内容；Prompt/Skill 规则不能保证彻底防住提示注入，仍需权限隔离和真实评测。

生产构建已显式包含默认配置与 `skills/**` 文件。若用 `AGENT_CONFIG_PATH` 指向部署包外的位置，需要自行挂载该配置，不能假定服务端打包器会自动带上它。

## 界面取舍

“创建任务”位于侧栏和输入框「＋」。填写目标、可选原文/链接、调查方式后，在独立的新对话执行，可补充消息或停止；保留对话地址、历史和正常消息保存。当前是前台任务，不是后台调度或关闭页面后自动续跑。联网选项是优先搜索偏好，自动模式仍由 Agent 根据目标选择工具。

Exa 来源适配保留完整工具正文，但只将服务返回头部转成来源字段，不从回答或普通正文猜链接。网页读取只接受每个文本块开头的一个服务头；批量读取的后续网页仍在原始返回中，但不从正文边界猜测来源，完整来源清单应结合搜索结果。来源仍标为未核验，不能把网页返回误当原文比对或法律事实确认。

对齐 ChatGPT 桌面端的聊天布局：可收起的会话侧栏、窄幅对话、空会话居中输入、会话中底部输入、轻量工具卡、浅/深色主题。首页移除调查建议卡、连接横幅和重复 Skills 入口；顶栏仅保留一个模型选择器，手机也沿用这个入口。使用自己的 Research 标识，不声称这是 ChatGPT 官方客户端或像素级复刻。

输入框的「＋」统一收纳图片、联网搜索偏好和设置入口。图片仍仅支持已配置存储的 JPEG/PNG；搜索入口需要已配置的搜索 MCP 与支持工具的模型。选择联网搜索后显示可取消标签，并将 `searchMode: web` 传给服务端提示模型优先调用现有搜索/正文工具、引用真实返回来源；这是调用偏好，不保证工具成功，不绕过工具确认，也没有新增自制搜索工具。

设置从账号菜单或「＋」打开，分常规、工具连接、技能三页。常规先显示主题与连接状态，配置模板在下方；Skills 不再占据主界面，Agent 的按需加载逻辑不变。对话菜单收纳链接复制、私密/公开和来源导出；复制私密链接不会自动公开对话，公开必须由用户明确选择。

消息保留正文复制、用户消息修改和回复反馈，补充最新回答的重新生成。服务端使用已存的原问题，不重复插入用户消息；生成明确结束后，在数据库事务中校验会话归属和原消息快照，再更新原回答并清除旧反馈。问题与回答 ID 保持不变；失败、中止、缺少结束标记的流不会替换数据库回答，客户端也恢复原回答。切换会话停止旧请求，成功后同步消息缓存，迟到回调不能清空另一会话的恢复快照。当前没有回答版本切换/分支；有待确认或未完成工具的回复不能重新生成。

继续使用官方文档产物侧栏，不另造 Canvas。文档预览支持键盘打开；收起会话侧栏不会隐藏文档的关闭按钮。代码、表格和引用沿用现有 Markdown/工具组件。

工具状态来自真实 UIMessage parts；来源卡读取结构化工具返回或模型服务的 source-url，不从回答文本猜链接。来源存在不代表内容已核验，侵权风险结论必须由 Skill 区分原文、摘要、线索与不足。

标题搜索查询当前账号的全部历史，不局限于侧栏已经加载的 20 条；搜索框支持 ⌘/Ctrl K，显示最多 30 条，暂不搜索消息正文。对话可重命名，服务端验证标题长度与归属，成功后同步侧栏和搜索缓存。删除与可见范围切换只在服务器成功后更新状态，失败保留原记录或权限，不显示假成功。

已有来源工作区收到对话菜单中：跨消息去重、按标题/网址筛选、复制当前筛选清单、导出对话正文与来源为 Markdown。只读取模型服务引用与已完成的 MCP 结构化返回，不把用户粘贴的链接、回答正文链接当作已查得来源。每个返回最多提取 12 条、整段对话最多汇总 200 条；不是完整取证档案。导出不含推理、原始工具日志、图片文件，不自动发送给第三方。

文字草稿按账号和对话隔离，使用当前浏览器标签页的 sessionStorage，刷新后可以恢复；不持久写入 localStorage 或上传到服务器。关闭标签页后不保证保留，浏览器禁用存储时仍能输入。图片不会作为草稿跨刷新恢复。执行失败显示常驻提示，可恢复最后的用户输入；这是手动恢复再提交，不是自动重试或保证 exactly-once。历史加载失败可重试读取，加载期间不接受误发到尚未载入的会话。

配置面板显示缺少的环境变量名称和可复制的空值模板，不读取或保存真实密钥。模板应合并到已有 .env.local，不应覆盖认证和数据库配置；重启服务后可刷新状态。输入框移除了终端风格的斜线命令，以“/”开头的正文不再被吞掉。

当前是桌面风格 Web 应用，不是已打包的 macOS/Windows 原生应用。

### 三栏与网页级 computer use

右侧工作区统一浏览器、文档、来源，不叠加另一套来源抽屉。可以拖动分栏、键盘调整宽度、展开、关闭；切换标签保留内容，手机覆盖显示，Escape 关闭。文档编辑和来源筛选/导出复用已有组件。

浏览器使用微软官方 `@playwright/mcp@0.0.83`，不是自制搜索/点击工具。Agent 使用 DOM 快照，真人看到同一个 MCP 当前标签页的 Chromium 截图（约 1.2 秒刷新），点击/滚轮/按键和中文文本输入同样通过 MCP。不是 iframe、视频串流、原生桌面控制，也不读取用户 Chrome 的账号或 profile。交回控制权不自动重启旧任务，需要用户发送新消息。

本地启用：安装依赖后执行 `corepack pnpm exec playwright install chromium`，在已有 `.env.local` 中增加 `BROWSER_RUNTIME=local`，重启常驻 Next Node 服务。默认禁用；不要直接启用在公开/serverless/multi-worker部署中。会话、控制修订和确认绑定目前是单进程内存状态，重启会丢失页面并拒绝旧确认。后续生产部署应拆出独立浏览器 worker、容器/网络隔离和集中会话状态。

按拥有者和对话隔离浏览器；服务端再次校验会话归属，公开对话的只读访客不能访问画面。控制写接口要求同源 Origin，最多 4 个浏览器、每账号最多 2 个，停止使用 20 分钟后释放。关闭工作区只隐藏界面，结束浏览器会话才释放浏览器。源码/脚本/文件上传/任意 evaluate 等 MCP 工具不暴露；网页注册的 WebMCP 工具也禁用。浏览器进程不继承模型和数据库密钥，保持 Chromium sandbox，禁用下载和 service worker。浏览器出口通过本地代理解析并固定公网 IP，拦截内网/元数据/本地地址和非 80/443 端口（覆盖重定向和子资源），而不把 MCP 的 origins 参数当作安全沙箱；这不是已完成渗透测试或完整恶意站点隔离认证。

除读取 DOM 快照外，Agent 的导航/点击/输入等动作均需确认。暂停/接管先撤销控制修订，等待已开始的动作结束后才确认切换；旧排队动作和接管前的确认不能在交回后恢复权限。浏览器实际返回的 URL/title 可进入来源清单，画面和浏览器 cookies 不写入对话或数据库。

新增验证：`tests/unit/browser.test.ts`（网络、同源、控制修订、流式事件），`tests/unit/browser-runtime.test.ts`（真实 MCP/Chromium、当前标签页一致性、中文输入、旧确认拒绝）；`tests/visual/workspace.py`（分栏/状态/手机），`tests/visual/browser_workspace.py`（真实浏览器界面、快速键入、画面、导航、暂停/接管、账号隔离）。这些检查不调用付费模型；无模型密钥时，Agent 自主操作全链路仍未验收。

## 验证

```sh
corepack pnpm exec tsc --noEmit
corepack pnpm exec tsx --test tests/unit/agent.test.ts tests/unit/message-turn.test.ts
corepack pnpm exec tsx --test tests/unit/browser.test.ts tests/unit/browser-runtime.test.ts
corepack pnpm exec tsx --test tests/unit/model-connection.test.ts
NODE_OPTIONS=--conditions=react-server corepack pnpm exec tsx --test --test-force-exit tests/unit/regeneration-db.test.ts
python3 tests/visual/desktop.py
python3 tests/visual/tool_states.py
python3 tests/visual/history.py
python3 tests/visual/chat_shell.py --case all
python3 tests/visual/regeneration_navigation.py
python3 tests/visual/artifact.py
python3 tests/visual/workspace.py
python3 tests/visual/browser_workspace.py
# Starts and stops its own production server on 3001, using only a local HTTP model fixture.
python3 tests/visual/model_connection.py
python3 tests/visual/task_experience.py
# Explicit opt-in: real configured model + public Exa MCP; cleans only its own test chat.
LIVE_AGENT_TEST=1 python3 tests/visual/live_task.py
corepack pnpm build
```

Python 浏览器测试需要 Playwright 和 Chromium；已有服务需监听 3000。`desktop.py` 检查真实本地界面、草稿、配置模板和缺少密钥的错误，不伪造联网结果。`tool_states.py` 仅使用显式测试夹具验证工具状态、确认、来源组件、复制与下载，不能算作搜索服务验收。`history.py` 使用真实本地认证、数据库和服务器操作验证全历史标题搜索、账号隔离、重命名、权限切换和删除；只生成与清理明确的随机测试记录，不删除用户已有对话。截图保存在忽略目录 `.local-review/`。

当前新增 3 项消息回合边界单测（与原有测试共 18 项）及 1 项真实 PostgreSQL 重新生成持久化测试。后者只创建和清理随机测试记录，验证归属、原问题不重复、回答替换、旧反馈删除和过期快照拒绝。新增聊天壳、重新生成导航和文档侧栏三套浏览器检查：模型 SSE、文档、导航测试明确使用夹具，不等于真实外部服务验收；包含请求失败、缺失结束标记、旧请求迟到、新回答缓存恢复等情况。历史搜索/重命名/权限/删除继续走真实本地数据库。

本轮聊天体验验收（2026-10-10）：TypeScript、60 个相关文件的 Biome、18 项单元测试、1 项真实数据库测试和生产构建通过；上述 6 套浏览器检查均在开发与生产模式通过，没有页面 JavaScript 异常。文档侧栏另验证了键盘打开和手机全屏打开/关闭。重新生成导航测试覆盖 A→B 及 A→B→A 的迟到回调；使用 SDK 公共 `Chat` 实例按实例隔离回调，而不是仅靠 URL 或问题 ID 判断归属。生产追踪清单包含默认配置和技能，不包含环境文件或截图目录。

生产 HTTP 本机登录的 Cookie 选择与 Auth.js 的实际 URL 协议对齐，保留上一轮对上游模板重定向循环的修复。上线前仍需运行上述完整检查并核对生产追踪清单：Agent API 应包含默认配置和技能文件，不包含 `.env`、`.local-review` 或 `next.config.ts`。

## 最新任务与搜索验收（2026-10-10）

已用用户指定的兼容接口与 `gpt-5.6-luna`，从真实生产页面“创建任务”执行 `loadSkill`、`exa__web_search_exa` 和 `exa__web_fetch_exa`，三项均返回成功。实际读取 `https://openai.com/form/copyright-disputes/`，来源进入工作区，消息写入本地数据库，刷新后正文、工具结果与技能显示恢复；页面 JavaScript 错误为零。仅清理随机测试对话，并释放其浏览器会话。截图在忽略目录 `.local-review/live-task.png`。此验收证明链路可用，不等于知识产权案件的判断准确率验收。

25 项相关单元/SDK 集成检查、14 个文件 Biome、TypeScript 和最终生产构建通过。任务入口测试使用明确的模型流夹具，覆盖必填目标、方法用途、搜索偏好、独立对话 URL、刷新不重复发送、旧回复中断后创建独立任务和手机入口。工具状态/确认/来源工作区、缺少密钥的桌面交互、工作区布局和自定义接口持久化回归通过；缺少密钥测试在隔离的 3002 服务运行，模型接口回归用本机 HTTP 夹具，不使用真实 Key。正文中的伪来源头回归已覆盖；审查修复任务地址未切换和来源边界问题。3000 保持真实配置的生产服务。

## 界面细节验收（2026-10-12）

本轮复用原模板的 Select、Textarea、Tooltip 与中性色表面；对话和工作区标题栏统一为 56px，输入框阴影使用主题变量。任务弹窗采用独立滚动正文和固定操作栏、唯一字段 ID 与手机 16px 输入字体；模型能力未加载或读取失败时禁用开始，重试重新读取模型与工具配置。技能用途只显示一次，工具来源默认展示三条、可展开全部，确认或错误到达时自动展开工具卡。工作区标签支持 Home/End，弹窗消费 Escape 后不关闭下面的工作区。

TypeScript、相关组件的 Biome、25 项相关单元/SDK 检查和生产构建通过。新增 `tests/visual/ui_refinement.py` 在开发及生产模式通过，覆盖窄屏工具标题、来源展开、技能用途去重、键盘选择不误提交、短手机弹窗操作按钮可见，以及工作区 Home/End 和模态 Escape。冷缓存模型接口失败与重试恢复另有生产回归；审查发现模型选择器/输入菜单原有读取会把 HTTP 错误缓存为正常能力数据，已统一使用检查状态码的 fetcher。任务入口与工具确认/来源回归在两种模式通过；工作区布局回归在开发模式通过。测试使用明确的历史与模型流夹具，不调用付费模型；本轮没有重跑真实模型调查。生产浅色/深色和三栏页面另经浏览器检查，无页面 JavaScript 异常。

当前生产服务在 `http://127.0.0.1:3003`；3000 被另一个项目占用，本轮未停止或修改该项目。可使用 `LOCAL_TEST_BASE_URL=http://127.0.0.1:3003 python3 tests/visual/ui_refinement.py --case all`；任务入口、工具状态和工作区脚本同样支持这个变量。生产 agent/browser 文件追踪不包含环境文件或截图目录。

应用登录仍为上游邮箱密码/本地访客模式，尚未接入 GitHub OAuth；开发者的 GitHub CLI 登录与应用用户认证相互独立。2026-10-12 已核对 CLI 登录账号为 `LordFoxFairy`，创建私有产品仓库 `LordFoxFairy/chatnest`。`origin` 用于产品代码，`upstream` 保留官方 `vercel/chatbot`。

## 上游更新

模型直连早期验收（2026-10-10）：27 项单元/集成检查、相关 13 个文件 Biome 和生产构建通过。`model-connection.test.ts` 验证连接选择、URL 校验、完整模型 ID，以及真实 SDK 发出的 Chat Completions、流式、标题和 Responses 请求，使用本机 HTTP 夹具。`model_connection.py` 在独立 3001 端口启动同一生产构建，验证运行时模型列表、界面、聊天/标题/流式的路径与认证、数据库保存和刷新恢复，结束后清理测试对话并停止测试进程。实际服务的最新结果见上方任务与搜索验收。

三栏/浏览器早期验收（2026-10-10）：24 项单元/真实 MCP 浏览器检查、1 项 PostgreSQL 检查、相关文件 Biome 和生产构建通过；8 套 UI 检查在开发与生产模式通过。验证真实浏览器、工作区、桌面输入及重新生成导航；审查修复了确认重新校验时的旧授权恢复，以及历史浏览器结果误打开工作区。回归覆盖控制交回、确认记录淘汰、浏览器重启和流式参数状态。最终 chat/browser 生产追踪清单不包含环境文件、截图目录或 Next 配置。最新搜索任务验收见上；真实模型自主浏览器调查仍需单独验收。

保持 `upstream` 指向官方仓库，`origin` 指向 `LordFoxFairy/chatnest`。产品新增逻辑主要集中在 `lib/agent/`、`skills/`、`config/` 和独立 UI 组件；原模板只保留必要接入点，不能承诺所有更新无冲突。

更新时先获取上游并审阅差异，在单独分支选择安全修复或合并目标提交，再运行类型、边界、浏览器和生产构建检查。保留锁文件，AI SDK 与 MCP 客户端一起验证；当前 MCP 固定 `2.0.7`，匹配模板 AI SDK `7.0.15` 的 provider-utils 类型版本，不直接追 latest。

## 仍未实现／验收

- 已配置并实测用户指定的 OpenAI 兼容接口及 `gpt-5.6-luna`；技能加载、Exa 搜索/正文读取、来源与保存刷新已完成真实链路验收。密钥仅保存在被 Git 忽略、权限为 600 的 `.env.local`，不记录在本文或测试代码。可选 Tavily 尚无密钥；具体侵权案件的误报/漏报评测仍未完成。
- PDF/视频/课程附件解析、OCR、海量文本比对尚未接入；图片上传也需实际存储凭据验收。
- 无脚本执行沙箱、后台任务调度或持久恢复保证；保留上游可选 Redis 流恢复不等于可靠长任务系统。
- 无法律事实自动认定、自动投诉、平台下架或司法取证功能。
- 尚需针对真实案件评测误报、漏报、成本、来源准确性和提示注入；不能仅凭 UI 测试宣称生产就绪。
