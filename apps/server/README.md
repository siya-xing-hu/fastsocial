# Fast Social 本地监控服务

这是供个人使用的本地服务。它监听 `127.0.0.1:3000`，将配置写入被 Git 忽略的根目录 `.data/fastsocial.db`，负责：

- 直接请求 X Web 内部接口读取指定用户的新帖子；
- 使用 OpenAI 兼容模型按每条规则的 Prompt 判断是否命中；
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

服务健康检查为 `http://127.0.0.1:3000/health`。在 `apps/server` 目录构建并启动 JavaScript 产物：

```bash
pnpm build
pnpm start
```

也可以从仓库根目录运行：

```bash
pnpm build:server
pnpm start:server
```

如果 3000 端口已被其他程序占用，需要先关闭占用程序；扩展当前固定连接该地址。

可用环境变量：

- `FAST_SOCIAL_DATA_DIR`：覆盖 SQLite 数据目录，建议使用绝对路径。
- `FAST_SOCIAL_PORT`：覆盖监听端口；插件正常使用时仍需保持为 `3000`。

## 配置顺序

1. 构建并加载扩展，打开扩展设置页的“监控服务”。
2. 配置至少一个 OpenAI 兼容服务：完整 Chat Completions URL、API Key 和模型名，并选择默认模型。
3. 配置 X Cookie、Telegram Bot Token 与 Chat ID，分别使用测试按钮确认。
4. 新建监控规则，填写 X 用户名、检查间隔和判断 Prompt。
5. “测试”只读取最新帖子并显示 AI 判断，不发送 Telegram，也不改变监控游标。

规则首次由定时器执行时只记录当前最新帖子作为基线，不通知旧帖子。之后的新帖子从旧到新判断；AI 或 Telegram 失败会在规则上显示错误，不重试或补发。

## 获取 X Cookie

1. 在浏览器中正常登录 `x.com`。
2. 打开开发者工具的 Network 面板并刷新页面。
3. 选择一个发往 `x.com/i/api/graphql/...` 的请求。
4. 从 Request Headers 复制完整的 `cookie` 值并粘贴到设置页。

Cookie 等同于登录凭证，只应保存在自己的电脑上，不要提交、截图或发送给他人。Cookie 失效后重新复制即可。

X 会不定期调整内部 GraphQL operation。代码中的默认 operation ID 可通过环境变量临时覆盖：

```bash
X_USER_BY_SCREEN_NAME_OPERATION_ID=... \
X_USER_TWEETS_OPERATION_ID=... \
X_WEB_BEARER_TOKEN=... \
pnpm dev:server
```

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

- `本地服务未启动或无法连接`：确认服务运行且端口 3000 未被占用。
- `X Cookie 已失效` 或 `缺少 ct0`：重新复制完整 Cookie。
- `X 用户响应结构已变化`：X operation 或响应结构发生变化，需要更新 X Adapter。
- `AI 返回内容不是有效 JSON`：换用指令遵循更稳定的模型，或收紧监控 Prompt。
- `Telegram 发送失败`：检查 Token、Chat ID，以及 Bot 是否有目标会话权限。
