# Fast Social

Fast Social 是一个供个人使用的 X/Twitter 辅助工具，由 Chrome 插件和本地服务端组成。

## 核心功能

- 使用自定义 Prompt 辅助生成帖子和回复
- 支持 OpenAI Chat Completions 与 Anthropic Messages 兼容服务
- 提供支持流式输出的 AI 聊天助手
- 支持 Google、DeepL 和 AI 翻译
- Google 翻译限流时自动切换到 DeepL，并在设定时间后重新尝试 Google
- 支持推文自动翻译、网页快捷键翻译和译文悬停展示
- 可在配置页管理模型、API Key、X Cookie 池、翻译服务和 Prompt

## 项目结构

```text
apps/extension/      Chrome 插件源码、依赖和构建配置
apps/server/         本地服务端源码、依赖和构建配置
packages/contracts/  插件与服务端共享的 API 类型
dist/extension/      插件构建结果
dist/server/         服务端构建结果
.data/               本地 SQLite 数据
```

各模块管理自己的直接依赖，全仓使用一个 pnpm workspace 和一个根 `pnpm-lock.yaml`。

## Docker 一键启动

根目录执行：

```bash
docker compose up --build
```

这条命令会同时构建插件和服务端，然后：

- 在 `http://127.0.0.1:5127` 启动本地服务；
- 将 SQLite 数据持久化到 `.data/`；
- 将服务端和插件产物分别导出到 `dist/server/` 与 `dist/extension/`。

Chrome 加载已解压扩展时选择 `dist/extension`。停止服务使用：

```bash
docker compose down
```

如果 AI 服务运行在宿主机（例如 Ollama 或本地 API 网关），容器中的服务地址应使用 `host.docker.internal`，不能使用 `localhost` 或 `127.0.0.1`。

## 开发

需要 Node.js 24+ 和 pnpm。安装依赖：

```bash
pnpm install
```

分别在两个终端启动服务端和插件开发环境：

```bash
pnpm dev:server
pnpm dev:extension
```

也可以进入对应的 `apps/extension` 或 `apps/server` 目录运行各自的 `pnpm dev`、`pnpm test` 和 `pnpm build`。

## 构建与启动

```bash
pnpm build
pnpm start:server
```

Chrome 加载已解压扩展时选择 `dist/extension`。服务端产物为 `dist/server/index.js`，本地配置和数据库保存在不会被构建清理的 `.data/`。

## 本地 AI 监控服务

项目现在包含一个仅通过宿主机 `127.0.0.1:5127` 访问的个人本地服务，用于保存 AI、X Cookie 池、Telegram 和监控规则，并按 Prompt 判断指定用户的新帖子是否需要通知。

打开扩展设置页中的“监控服务”即可配置。服务不可用时，AI 聊天、发帖／回复 Prompt 和监控配置会停用；Google 与 DeepL 翻译仍可独立工作。

详细配置方法、凭证说明和常见错误见 [服务端说明](apps/server/README.md)。
