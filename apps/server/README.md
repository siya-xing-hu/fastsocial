# Fast Social 本地监控服务

这是供个人使用的本地服务。它默认监听 `127.0.0.1:5127`，将配置写入被 Git 忽略的根目录 `.data/fastsocial.db`，负责：

- 直接请求 X Web 内部接口读取指定用户的新帖子；
- 使用 OpenAI Chat Completions 或 Anthropic Messages 兼容模型按每条规则的 Prompt 判断是否命中；
- 命中后按编排顺序关注作者、生成或发送固定回复、通过 Telegram 通知；
- 为浏览器扩展提供 AI、互动 Skills、账号 Profile 和自动翻译开关。

Google、DeepL、目标语言和自动翻译仍保存在浏览器扩展中，不依赖此服务。

## 启动

需要 Node.js 24+ 和 pnpm：

```bash
# 仓库根目录
pnpm install
pnpm dev:server
```

也可以从服务端模块内启动：

```bash
cd apps/server
pnpm dev
```

服务健康检查为 `http://127.0.0.1:5127/health`。在 `apps/server` 目录构建并启动 JavaScript 产物：

```bash
pnpm build
pnpm start
```

也可以从仓库根目录运行：

```bash
pnpm build:server
pnpm start:server
```

如果 5127 端口已被其他程序占用，需要先关闭占用程序；扩展当前固定连接该地址。

可用环境变量：

- `FAST_SOCIAL_DATA_DIR`：覆盖 SQLite 数据目录，建议使用绝对路径。
- `FAST_SOCIAL_HOST`：覆盖监听地址；本地默认 `127.0.0.1`，Docker 中使用 `0.0.0.0`。
- `FAST_SOCIAL_PORT`：覆盖监听端口；插件正常使用时仍需保持为 `5127`。

## Docker

从仓库根目录执行：

```bash
docker compose up --build
```

Compose 会挂载根 `.data/` 到容器 `/data`，并挂载根 `dist/` 到 `/output`。容器启动时会把服务端和插件构建结果复制到 `dist/server/` 与 `dist/extension/`；实际服务端进程仍从镜像内部运行，不会被 `dist` 挂载覆盖。

如果 AI 服务或 Ollama 运行在宿主机，Endpoint 应使用 `http://host.docker.internal:<端口>`，不能使用 `localhost` 或 `127.0.0.1`。

如果宿主机能访问 Telegram、容器却出现连接超时，可在根目录 `.env` 中设置已有的 HTTP 代理。例如，本机代理监听 7897 端口且允许容器连接时：

```dotenv
FAST_SOCIAL_HTTPS_PROXY=http://host.docker.internal:7897
```

执行 `docker compose up -d` 重新创建容器后生效。Compose 通过 Node 的 `NODE_USE_ENV_PROXY` 启用代理；HTTPS 外部请求（包括 X 和 Telegram）使用该代理，本机服务、健康检查和 `host.docker.internal` 默认直连。如需添加其他直连地址，设置 `FAST_SOCIAL_NO_PROXY`，并保留这些默认地址。未配置代理时仍按原方式直接连接。

## 配置顺序

1. 构建并加载扩展，打开设置页。
2. 在“AI 服务”配置服务地址、API Key、模型及默认模型。
3. 在“账号设置”添加账号名称、用户名、Cookie、主语言和 Profile；自动翻译直接在账号列表中切换。发帖权限自动识别，无需配置。在“互动 Skills”编辑总结、发帖、回复各自完整的 SKILL.md 文档。
4. 在“插件设置”选择翻译渠道、目标语言、AI 翻译指令和 DeepL 参数；这些值保存在当前浏览器。
5. 在“账号设置”点击账号行的“测试”，读取该账号首页 Post，结果展示作者、正文和原帖链接；不需要填写测试用户名。在“连接配置”设置 Telegram。
6. 在“动作监听”新建编排：执行账号默认随机，填写监听范围和 AI 判断条件，再通过横排按钮添加有序动作。没有动作可保存为停用草稿，添加动作后才能启用或立刻执行。

“立刻执行一次”在二次确认后运行完整编排，包括内容抓取、AI 批量判断和配置的动作；执行中显示当前批次、累计扫描数、AI 命中数与处理完成数；结束显示累计总数。正式执行仅处理编排创建之后的帖子；通知直接发送到连接配置中的 Telegram。账号首页测试、AI 测试及画像更新也在确认后才发送请求。

账号列表中的自动翻译开关是服务在线时的启用依据。服务离线时，浏览器按基础设置统一运行，不使用旧的账号设置缓存；X 页面每 15 秒检查服务恢复或配置变化，切换账号时重新解析。AI 不可用时，翻译回退至 Google / DeepL。

Chrome 116+ 中按 Alt + Shift + S 打开／收起 X 页面内的右侧聊天助手，支持 `/summary`、`/post`、`/reply` 和自然语言选择任务。`/` 菜单支持上下键、Enter 确认与唯一匹配时 Tab 补全；Shift + Enter 换行。聊天记录及未发送草稿保存在浏览器本地，历史支持继续和删除。服务端根据每次自动读取的页面账号应用主语言和 Profile；未知账号使用通用风格，切换账号后另开会话。页面内容作为引用输入，不包含 Cookie。发帖和回复呈现为草稿卡片，支持继续修改、复制或填入原生草稿；填入前校验生成时的账号、原帖和编辑器，不自动发布。

## 获取 X Cookie

X 抓取通过模拟 `x.com` 网页端的浏览器请求实现，复用登录 Cookie、CSRF 和网页客户端参数，不使用 X 开发者 API。

1. 在浏览器中正常登录 `x.com`。
2. 打开开发者工具的 Network 面板并刷新页面。
3. 选择一个发往 `x.com/i/api/graphql/...` 的请求。
4. 从 Request Headers 复制完整的 `cookie` 值，填入“账号设置”中对应的账号。动作监听在每轮开始时确定账号，后续读取、关注和回复均由该账号执行，不会中途换号；首页、关注和回复需要 Cookie 中的 `twid` 来固定身份。

Cookie 等同于登录凭证，只应保存在自己的电脑上，不要提交、截图或发送给他人。Cookie 失效后重新复制即可。

X 会不定期调整内部 GraphQL operation。代码中的默认 operation ID 可通过环境变量临时覆盖：

```bash
X_USER_BY_SCREEN_NAME_OPERATION_ID=... \
X_USER_TWEETS_OPERATION_ID=... \
X_WEB_BEARER_TOKEN=... \
pnpm dev:server
```

若测试返回 404，先检查错误里标出的 `HomeTimeline`（账号首页测试）、`UserByScreenName` 或 `UserTweets`，对照浏览器 Network 中对应请求的 operation ID、`features`、`fieldToggles` 和浏览器请求头。X 也可能对缺少浏览器上下文的请求返回空 404；客户端会携带 `User-Agent`、`Origin`、`Referer`、语言和 Fetch Metadata 请求头。需要更新浏览器标识时可设置 `X_WEB_USER_AGENT`。404 本身不代表 Cookie 失效；只有明确的认证错误才会标记 Cookie 失效。当前默认参数核对自 2026-09-23 的 X 网页脚本 `main.60bedca26c9a9faaa.js`。

Docker 运行的是镜像内的服务端代码，修改这些参数后需要运行 `docker compose up --build -d` 重新构建并启动，单独构建本机 `dist` 不会更新容器。

## Telegram

1. 在 Telegram 中通过 BotFather 创建 Bot 并取得 Token。
2. 给 Bot 发送一条消息，或将 Bot 加入目标群组。
3. 取得对应 Chat ID，填入设置页后点击“发送测试消息”。

## 检查

```bash
# 仓库根目录，检查所有模块
pnpm check

# apps/server 目录，仅检查服务端
pnpm test
pnpm build
```

常见错误：

- `本地服务未启动或无法连接`：确认服务运行且端口 5127 未被占用。
- `X Cookie 已失效`、`缺少 auth_token` 或 `缺少 ct0`：在账号设置中更新对应 Cookie。
- `AI 服务连接失败` 且 Endpoint 使用 `localhost`：Docker 启动时改用 `host.docker.internal`。
- `X 用户响应结构已变化`：X operation 或响应结构发生变化，需要更新 X Adapter。
- `AI 返回内容不是有效 JSON`：换用指令遵循更稳定的模型，或收紧监控 Prompt。
- `Telegram 发送失败`：检查 Token、Chat ID，以及 Bot 是否有目标会话权限。
- `Telegram 连接超时` 或 `Telegram 连接失败`：检查运行服务的容器是否能访问 `api.telegram.org`；宿主机可以访问不代表容器可以，必要时按上文配置代理。

## 数据与配置保留

- `managed_accounts` 保存账号基本信息、Cookie 和独立的自动翻译开关；设置 API 只返回 Cookie 是否存在和状态，不返回明文。
- `managed_account_profiles` 保存账号主语言和 Profile，删除账号时级联清理。首次升级保留旧写作语言、风格和翻译关联；旧账号未设语言时，优先保留其唯一的旧监听回复语言，否则使用 `zh-CN`。
- `configurations` 保存自动翻译配置项及保留的旧 Prompt 数据；旧模板管理入口已移除，旧监听引用仍可运行。
- `assistant_skills` 只保存主键、命令、显示名称、简介、文件相对路径、启用状态、内容指纹和更新时间，不再保存正文。实际正文位于数据库同目录的 `skills/{summary,post,reply}/SKILL.md`；Docker 中为 `/data/skills`，对应宿主机 `.data/skills`。仓库 `src/assistant/skills` 只作为首次初始化的默认文档，重启或更新不会覆盖现有文件。旧数据库正文先导出文件再移除正文列；与已有文件冲突的旧正文另存为 `SKILL.legacy-*.md`。文件修改后下一次读取立即生效并同步简介；文件异常会在管理页提示并停止调用。
- `account_writing_preferences` 保留旧版本兼容数据，删除账号时级联清理；旧 `posting_mode` 值不再读取或用于判断权限。
- `account_config_bindings` 仅保留旧 Prompt 的账号关系，自动翻译已改用账号字段。取消关联或删除账号不会删除模板；删除模板会清理对应关系。
- `workflows`、`workflow_seen`、`workflow_records` 保存动作监听编排、已处理帖子和各动作结果。
- `account_request_limits` 保存账号各行为的每日上限，`account_request_usage` 按实际账号身份、日期与行为记录请求次数；更换 Cookie、服务重启不会清零已有统计。
- AI 服务和 Telegram 保留在原 `settings` 表。旧 Cookie 和 Prompt 在首次启动时复制到新表，旧变量名转换成 `{input}`、`{reply}`、`{{_tl_}}`。未自行猜测账号的功能关联。
- 旧用户监听与互关配置尽量转成停用的编排。首次使用时确认执行账号、范围和动作后再启用；旧任务调度器不会同时启动。

## 动作执行

后端默认记录完整执行链路和每次请求的可复制 curl：

```bash
docker compose logs --no-log-prefix --tail=500 -f fast-social
```

使用 `runId` 跟踪一次监听，使用 `requestId` 对照某条 curl 与状态码、原始响应、耗时；`workflow.finish` 是整体结果。包括获取的 Post 原文、AI 请求与响应、判断结果、关注和回复、跳过原因及异步画像。按用户要求，curl 中的 Cookie、API Key 等不脱敏。只打印命令，不自动执行；从新版本启动后的请求开始记录，原有失败请求不能补录。细节见 [请求链路日志](../../docs/wiki/development.md#请求链路日志)。

支持单个指定用户和账号首页。指定用户监听可随机选择可用账号，每轮选择一次，所有读取及后续动作使用同一账号；账号首页必须指定账号。无可用账号时在执行前报错，执行记录保留实际账号。旧的多用户编排会拆成单用户编排，尽量保留配置、进度和执行记录。

首页每轮抓取一批 Post，先去重并排除已处理帖子，再整批交给 AI 判断；不按发布时间或任务创建时间过滤。通常一页 20 条只需一次判断请求；超过输入或输出预算时按完整帖子拆批，不截断原文。AI 必须按原始 Post ID 返回每条结果，所有批次通过校验后才执行命中帖子的动作；缺项、重复、未知 ID 或请求失败均不会推进本轮帖子处理进度。回复 Skill 仍按命中帖子分别生成回复。

包含“关注作者”的编排会先排除已关注、关注列表记录为已取消关注或待核对的用户；新目标在关注前查询最新 Profile。只有本次新关注成功才继续回复，同一作者多帖、并发任务不会重复回复。已取消关注视为主动退出自动互动，只有手动添加关注能重新建立关系。额度暂缓的回复恢复时需有该记录的新关注证明，并再次检查是否取消关注；排队发送前也会检查。执行记录中被阻止的后续动作显示“已跳过”，不计完成；所有编排的进度统一显示 AI 命中数，与新关注成功数分开统计；扫描数按本轮检查的 Post ID 去重，包含过滤跳过的帖子。

账号编辑中可分别设置每日首页请求、Profile/关系读取、用户 Post 分页、关注、取消关注与回复上限，初值为 100、100、200、20、20、20；0 表示禁止该类请求。这些是插件自定额度，不代表平台允许或安全的额度。北京时间每天 00:00 重置；同一账号的所有任务、测试、聊天中的 Profile 读取和画像更新共用计数。每个实际网络请求发出前原子计数，分页每页一次，已发送的失败请求和重试也计数，缓存命中不计数。达到上限后不切换账号绕过限制，任务等待次日额度或手动调整后重试。

监听、连续批量动作、自动画像任务的 X 请求共用串行队列，前一次排队请求结束后至少间隔 30 秒；手动“立即执行一次”仍是一整轮监听，也遵守该间隔。手动单次核对关系、账号测试、添加／取消关注、画像更新及聊天 Profile 查询直接发送。所有请求都受账号每日额度控制，手动超额明确报错；异步画像更新会在接受操作前预检额度。AI 判断、文案生成、通知和本地处理不排队。监听的自动画像抓取仍延后到本轮动作结束。具体发送、取消和超时约定见 [开发 Wiki](../../docs/wiki/architecture.md#账号和外部请求)。

指定用户每轮从最新页开始，帖子和回复轮流获取，**合计最多 5 次分页请求**，无下一页时提前结束。按本任务已处理的 Post ID 去重，不比较发布时间、任务创建时间或旧的最高 Post ID；首次运行也判断所有抓到的未处理帖子。达到上限正常处理本轮内容，不继续遍历历史，也不标记未抓取的帖子。空页有游标仍继续；重复游标、请求失败或额度耗尽保留未处理进度。旧最高 Post ID 只作记录，不是过滤边界。

指定用户的画像用于理解帖子、判断条件和生成回复。同一用户的监听任务共享画像。列表中的画像入口支持查看、修改和“更新画像”：更新时重新获取最新公开 Profile 与最近 20 条 Post（含回复），不沿用旧画像，成功后替换；失败保留原画像。该操作不执行动作、不改变监听进度，暂停或尚未添加动作的任务也可以使用。正常任务首次执行同时建立画像并判断未处理帖子，后续用已有画像和未处理内容增量更新。列表中的“立刻执行一次”可立即运行任务，结果在执行记录中查看。

动作默认空白，可按横排按钮添加、排序和移除：关注作者，回复固定内容或通过回复 Skill 生成，以及 Telegram 通知。回复 Skill 使用执行账号的主语言和 Profile，可填写针对当前任务的“回复要素”；留空时由原帖与 Profile 决定回复重点。任务要素优先于默认表达偏好，不能覆盖账号身份事实、表达边界、主语言或发布能力限制。编辑旧模板回复时，旧指令会带入回复要素，保存后使用 Skill。

正式动作执行前先持久化记录；同一编排与 Post 只执行一次。每步结果单独记录。读取或 AI 判断失败会保留监听进度，供后续重试；动作执行异常会暂停该编排。外部结果不确定或执行时发生重启，不会自动重发关注、回复和通知，应先核对记录。删除编排也会删除该编排的本地记录，不会撤销 X 上的动作。

关注接口返回目标用户但没有确认 `following=true` 时，使用同一执行账号通过 `UserByScreenName` 读取目标 Profile 的关注关系，并核对返回用户 ID；首次仍未关注则再查一次，最多两次；任务内核对遵守 30 秒队列，手动单次关注中的核对直接发送，两者均检查 Profile 每日额度。仅没有用户名的旧调用保留按 ID 查询。确认已关注后继续后续动作，核对过程不会重复发送关注请求。关系读取计入账号的 Profile 每日额度；核对被拒绝、额度不足或状态仍未确认时，保留不确定记录并停止后续动作。

`following_users` 按自己的稳定 X actor ID 与目标用户 ID 分开保存关注信息和画像。手动操作与监听共用账号锁和请求额度；写入前持久化待确认记录，重启后不重发。取消关注保留记录，刷新关系只读取数据。首次升级导入已有成功／不确定的本地关注记录，核对后才显示实际关系，不导入平台全部关注。画像任务串行运行，使用最新 Profile 和最多 10 条非转发 Post；摘要失败不改变关注结果，可单独重试。两个账号的关系与画像条目彼此隔离。

执行中统一显示“执行中：第 N 批，扫描了 X 条，AI 命中了 Y 条，处理完成了 Z 条”，完成时显示“执行完成：一共扫描了 X 条，AI 命中了 Y 条，处理完成了 Z 条”。三个数量始终为本轮累计值，AI 结果通过校验后才计入命中，单帖的全部动作成功后才计为完成一条；后续动作失败仍保留累计数量。列表在空闲时也读取运行状态，因此自动启动的任务会出现实时进度。

X 返回 Cloudflare HTML 拒绝页面（HTTP 403）时，明确显示被拒绝的请求类型，不将其当作 Cookie 已失效或未关注的证据，也不重复发送写入请求。需要在浏览器检查 X 访问状态；服务无法仅凭拒绝页面确认已发出动作的实际结果。

本地额度在请求发出前拒绝时，当前记录进入等待状态，保留已完成的步骤和执行账号。额度恢复后仅继续未发出的动作，成功的关注、回复不会重做；暂停的任务仍需手动执行。任务的账号、监听来源、条件或动作被修改后，原等待动作取消，并保留记录供核对。真正已发出请求而结果不确定的失败仍会停止任务，不自动重试。

X 请求使用既有网页接口，仍可能因 X 更新而失效。可覆盖 `X_HOME_TIMELINE_OPERATION_ID`、`X_CREATE_TWEET_OPERATION_ID`、`X_USER_BY_REST_ID_OPERATION_ID` 等已有环境变量；Docker 修改后需重新构建。自动化测试使用模拟响应，没有使用真实账号关注或发帖。

## 新配置接口

- `GET/POST /api/accounts`、`PUT/DELETE /api/accounts/:id`：账号和 Profile；兼容旧配置关联输入，忽略旧的手动发帖权限输入。
- `PUT /api/accounts/:id/translation`：以 `{ "enabled": true }` 独立保存自动翻译开关。
- `GET /api/accounts/:id/usage`：读取各类请求今日用量、上限与重置时间。通过账号保存接口的 `dailyLimits` 设置完整的 `home/profile/posts/follow/unfollow/reply` 六项非负整数，旧的五项配置补入默认取消关注额度。
- `GET/POST /api/accounts/:id/following`：当前账号的关注列表（可用 `q` 搜索）／按 `{username}` 手动关注。
- `POST /api/accounts/:id/following/:entryId/unfollow`、`/refresh`、`/summary`：取消关注、只读核对关系、后台更新画像。
- `GET /api/assistant/catalog?actorId=...&username=...`：可用且已启用的 Skills 和当前账号的写作风格，不返回凭证。
- `GET /api/assistant/skills`：所有 Skill 的元信息、文件原文和文件错误；设置页默认展示原文，点击编辑后直接修改文件。
- `PUT /api/assistant/skills/:key`：以 `instructions` 提交完整 SKILL.md，附带读取时的 `revision`；校验格式和版本后原子替换文件，数据库只同步元信息。冲突时保留页面草稿并提示刷新。
- `PATCH /api/assistant/skills/:key`：以 `enabled` 控制启用状态，不改动文件。停用后从快捷入口和命令菜单隐藏，手动命令、自动选择和监听调用均不可执行。
- `POST /api/assistant/posting-policy`：按当前账号身份和配置解析发帖长度预算，不返回凭证。
- `POST /api/assistant/chat`：根据当前输入、冻结的页面与连续对话生成文本，无发布副作用。历史消息可带当时的 `skill` 和用户消息的 `reference` 素材；跨 Skill 保留上下文，历史资料排在本轮页面之前。普通聊天响应不带 `skill` / `draft`，只有发帖与回复查询发布权限并校验正文长度。
- 旧 `/api/prompts` 接口保留以兼容已有配置。
- `GET /api/account-config?actorId=...&username=...`：解析当前账号的功能配置；明确提供 actorId 时优先使用稳定身份，不回退到其他账号。
- `GET/POST /api/workflows`、`PUT/DELETE /api/workflows/:id`：动作编排。
- `POST /api/workflows/:id/preview`：仅测试判断；可传当前未保存的完整配置。
- `GET/PUT /api/workflows/:id/profile`：查看画像及其依据，或以 `{ "text": "..." }` 手动修正画像。
- `POST /api/workflows/:id/profile/refresh`：以最新 Profile 和最近 20 条 Post 重新构建画像，不改变任务进度。
- `GET /api/workflows/:id/records`：最近 100 条执行记录。
