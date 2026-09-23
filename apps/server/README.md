# Fast Social 本地监控服务

这是供个人使用的本地服务。它默认监听 `127.0.0.1:5127`，将配置写入被 Git 忽略的根目录 `.data/fastsocial.db`，负责：

- 直接请求 X Web 内部接口读取指定用户的新帖子；
- 使用 OpenAI Chat Completions 或 Anthropic Messages 兼容模型按每条规则的 Prompt 判断是否命中；
- 命中后通过 Telegram Bot 立即发送通知；
- 为浏览器扩展提供 AI、Prompt 和监控配置。

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

## 配置顺序

1. 构建并加载扩展，打开扩展设置页的“监控服务”。
2. 配置至少一个 AI 服务：选择 OpenAI Chat Completions 或 Anthropic Messages 格式，填写完整 URL、API Key 和模型名，并选择默认模型。
3. 添加一个或多个 X Cookie，再配置 Telegram Bot Token 与 Chat ID，分别使用测试按钮确认。
4. 新建监控规则，填写 X 用户名、检查间隔和判断 Prompt。
5. “批量测试”读取最近 20 条帖子并显示 AI 判断，不发送 Telegram，也不保存正式画像或改变监控游标。

规则首次由定时器执行时只记录当前最新帖子作为基线，不通知旧帖子。之后的新帖子从旧到新判断；AI 或 Telegram 失败会在规则上显示错误，不重试或补发。

## 获取 X Cookie

X 抓取通过模拟 `x.com` 网页端的浏览器请求实现，复用登录 Cookie、CSRF 和网页客户端参数，不使用 X 开发者 API。

1. 在浏览器中正常登录 `x.com`。
2. 打开开发者工具的 Network 面板并刷新页面。
3. 选择一个发往 `x.com/i/api/graphql/...` 的请求。
4. 从 Request Headers 复制完整的 `cookie` 值并添加到设置页；多个 Cookie 会在抓取时随机选择，确认失效的条目会在列表中标记。

Cookie 等同于登录凭证，只应保存在自己的电脑上，不要提交、截图或发送给他人。Cookie 失效后重新复制即可。

X 会不定期调整内部 GraphQL operation。代码中的默认 operation ID 可通过环境变量临时覆盖：

```bash
X_USER_BY_SCREEN_NAME_OPERATION_ID=... \
X_USER_TWEETS_OPERATION_ID=... \
X_WEB_BEARER_TOKEN=... \
pnpm dev:server
```

若测试返回 404，先检查错误里标出的 `UserByScreenName` 或 `UserTweets`，对照浏览器 Network 中对应请求的 operation ID、`features`、`fieldToggles` 和浏览器请求头。X 也可能对缺少浏览器上下文的请求返回空 404；客户端会携带 `User-Agent`、`Origin`、`Referer`、语言和 Fetch Metadata 请求头。需要更新浏览器标识时可设置 `X_WEB_USER_AGENT`。404 本身不代表 Cookie 失效；只有明确的认证错误才会标记 Cookie 失效。当前默认参数核对自 2026-09-23 的 X 网页脚本 `main.60bedca26c9a9faaa.js`。

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
- `X Cookie 已失效`、`缺少 auth_token` 或 `缺少 ct0`：在连接配置列表中更新对应 Cookie。
- `AI 服务连接失败` 且 Endpoint 使用 `localhost`：Docker 启动时改用 `host.docker.internal`。
- `X 用户响应结构已变化`：X operation 或响应结构发生变化，需要更新 X Adapter。
- `AI 返回内容不是有效 JSON`：换用指令遵循更稳定的模型，或收紧监控 Prompt。
- `Telegram 发送失败`：检查 Token、Chat ID，以及 Bot 是否有目标会话权限。

### 账号画像与批量监听

首次读取目标账号简介和最近 20 条 Post 建立短画像（最多 250 字），之后只分析新增窗口。同账号到期规则共享抓取和批量判断，每批最多 30 帖且受输入预算约束；普通帖子原文保留 30 天，未处理内容和画像证据保留。设置页的“画像”可查看、修正和清空记忆，“批量测试”展示最近 20 帖的判断，不发送 Telegram 或修改正式进度。

X 请求使用网页 Cookie，分别读取帖子和回复分页。每次直接随机选 Cookie；失败最多换一份重试，不统计 Cookie 调用次数。AI 请求或结构化结果失败也最多重试一次。二次失败保留监听偏移量，由下次定时检查补齐；没有恢复队列或 token 用量记录。已确认发送成功的通知按规则和帖子去重，网络超时仍可能使实际发送状态不确定。

新增接口：`GET /api/monitors/:id/profile` 查看账号记忆和证据；`PUT /api/monitors/:id/profile` 用 `{ "text": "背景：…\n主题：…" }` 修正或传空文本清空。`POST /api/monitors/:id/run` 现在执行批量测试。
