# Fast Social 本地 AI 监控服务设计

日期：2026-09-21

## 1. 背景

Fast Social 当前是一个面向 X 的 Chrome 扩展，提供 Google、DeepL 和 AI 翻译、AI 发帖与回复、聊天以及 Prompt 快捷操作。所有配置和 AI 调用目前都在扩展本地完成，只有浏览器运行并打开相应页面时才能工作。

下一阶段需要增加一个本地常驻服务。它负责监控指定 X 用户的新帖子，使用用户配置的 Prompt 让 AI 判断内容是否值得关注，并在命中时发送 Telegram 通知。浏览器扩展继续负责 X 页面增强、基础翻译以及本地服务的配置界面。

该系统只供单个用户在自己的电脑上使用，第一阶段以最少组件和最低维护成本为目标。

## 2. 目标

- 在本机持续监控指定 X 用户的新帖子，不依赖浏览器保持打开。
- 使用每条监控规则自己的 Prompt 判断帖子是否命中。
- 命中后立即通过 Telegram Bot API 发送通知。
- 通过现有 Chrome 扩展配置本地服务和监控规则。
- 将 AI 服务、模型、API Key 和所有 AI Prompt 统一放到本地服务。
- 本地服务离线时，扩展的 Google 和 DeepL 翻译仍然可用。
- 为以后增加其他英文社区保留清晰的平台适配器边界。

## 3. 非目标

第一阶段不实现以下能力：

- 多用户、账号体系、权限、计费或远程部署。
- 帖子历史、AI 执行历史、通知历史或事件中心。
- 通知补发、持久任务队列、Redis 或多进程 worker。
- 图片 OCR、视频解析或外链正文抓取。
- SSE、WebSocket 或实时结果页面。
- 独立的服务端管理网页。
- 凭证加密、访问令牌或复杂安全策略。
- 对现有扩展做与本需求无关的全面重写。

## 4. 总体架构

系统由现有浏览器扩展、本地服务和共享 API 类型组成：

```text
X 页面
  ↕ content script
Chrome extension service worker
  ↕ HTTP（127.0.0.1）
本地 TypeScript 服务
  ├─ HTTP API
  ├─ Scheduler
  ├─ X Adapter
  ├─ AI Gateway / Matcher
  ├─ Telegram Notifier
  └─ SQLite
```

本地服务是 AI、监控配置和定时任务的唯一数据源。扩展设置页通过现有 runtime message 机制请求 extension service worker，再由 service worker 中的 `LocalServiceClient` 访问 `127.0.0.1`。内容脚本不直接访问本地服务。

第一阶段不移动现有扩展目录，避免大规模路径重构。仓库新增以下结构：

```text
fastsocial/
├─ src/                    # 现有扩展
├─ server/                 # 本地服务
├─ shared/contracts/       # 插件与服务共享的 API 类型
└─ pnpm-workspace.yaml
```

当服务和扩展边界稳定后，才考虑进一步整理成 `apps/extension`、`apps/server` 和 `packages/contracts`。

## 5. 能力边界和降级策略

| 能力 | 所有者 | 本地服务离线时的行为 |
|---|---|---|
| Google 翻译 | 扩展 | 正常使用 |
| DeepL 翻译及 Google 限流回退 | 扩展 | 正常使用 |
| 自动翻译、目标语言 | 扩展 | 正常使用 |
| X 页面注入和输入框交互 | 扩展 | 正常使用 |
| AI 发帖、回复和聊天 | 本地服务 | 隐藏或禁用入口，并显示服务离线 |
| AI 翻译 | 本地服务 | 降级为扩展现有的 Google／DeepL 自动翻译，并提示已降级 |
| AI 服务、模型和 API Key | 本地服务 | 不可编辑或使用 |
| 发帖／回复 AI Prompt | 本地服务 | 不显示对应 AI 快捷入口 |
| X 监控和 Telegram 通知 | 本地服务 | 暂停运行 |

扩展不缓存服务端 Prompt，也不维护 AI 配置副本。服务端在线时读取并展示 AI Prompt；服务端离线时不提供没有执行能力的 AI 配置界面。

扩展本地继续保存 Google／DeepL 配置、目标语言、自动翻译选项和本地服务地址。

## 6. 本地服务技术方案

- Node.js 24 或更高版本。
- TypeScript。
- Fastify 提供本地 HTTP API。
- Node 内置 `node:sqlite` 访问 SQLite，不引入 ORM。
- Node 内置 `fetch` 调用 X、AI 和 Telegram。
- 一个进程内使用 `setInterval` 每分钟扫描到期任务。
- 服务仅监听 `127.0.0.1:3000`。
- 第一阶段不增加本地 API 鉴权。

扩展 manifest 增加 `http://127.0.0.1:3000/*` host permission。所有访问集中在 extension service worker 中，页面 content script 不持有服务端配置或凭证。

## 7. 数据模型

SQLite 只包含 `settings` 和 `monitors` 两张表。

### 7.1 settings

`settings` 使用 `key TEXT PRIMARY KEY, value TEXT NOT NULL` 保存 JSON 配置。配置分组包括：

- `ai`
  - AI 服务列表。
  - 每个服务的名称、OpenAI 兼容 endpoint、API Key、模型列表和启停状态。
  - 默认 AI 服务和模型。
- `interaction_prompts`
  - 发帖和回复场景的 Prompt 模板。
  - 模板包含名称、场景、内容和启停状态。
- `x`
  - 用户手动粘贴的 X 登录 Cookie。
- `telegram`
  - Bot Token 和 Chat ID。

服务端返回配置时可以隐藏已保存 secret 的具体值；更新请求中不提供某个 secret 表示保留原值，提供新值表示覆盖。第一阶段 secret 仍以明文保存在本地 SQLite 中。

### 7.2 monitors

`monitors` 包含：

- `id`
- `name`
- `platform`，第一阶段固定为 `x`
- `username`
- `prompt`
- `interval_minutes`
- `enabled`
- `last_seen_post_id`
- `last_checked_at`
- `last_error`
- `created_at`
- `updated_at`

不保存原始帖子、AI 判断结果或 Telegram 发送结果。

## 8. HTTP API

### 8.1 服务状态

- `GET /health`
  - 返回服务版本、启动时间和数据库状态。

### 8.2 配置

- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/test/x`
- `POST /api/test/ai`
- `POST /api/test/telegram`

测试接口只验证当前配置并返回结果，不修改监控游标。

### 8.3 监控规则

- `GET /api/monitors`
- `POST /api/monitors`
- `PUT /api/monitors/:id`
- `DELETE /api/monitors/:id`
- `POST /api/monitors/:id/run`

`run` 获取该用户最新一条帖子并返回 AI 的 `matched` 和 `message`，不发送 Telegram，也不修改 `last_seen_post_id`。

### 8.4 插件 AI 能力

- `GET /api/ai/options`
  - 返回可用的服务和模型，不返回 API Key。
- `GET /api/prompts`
  - 返回启用的发帖和回复 Prompt。
- `POST /api/ai/chat`
  - 执行发帖、回复、聊天或 AI 翻译请求。
  - 支持普通响应和流式响应。

扩展 service worker 将本地服务的流式响应转发给现有页面消息监听器，尽量保持当前内容组件和聊天组件的调用方式不变。

## 9. X Adapter

第一阶段直接请求 X 内部接口，不运行浏览器自动化。用户在设置页手动配置登录 Cookie。

`XAdapter` 负责：

- 从 Cookie 中取得请求所需的登录和 CSRF 信息。
- 根据用户名解析平台用户 ID。
- 请求用户最近一小批帖子。
- 封装 GraphQL operation、请求头、feature 参数和响应路径。
- 将 X 响应转换为统一的 `SocialPost`。

```ts
interface SocialPost {
  id: string;
  platform: "x";
  author: string;
  text: string;
  createdAt: string;
  url: string;
  quotedText?: string;
  type: "post" | "reply" | "repost";
}
```

原创、回复和转发默认全部交给 AI 判断。接口 operation 或响应结构变化时，只修改 X Adapter，不影响调度器、AI 或 Telegram 模块。

## 10. 调度和处理流程

调度器每分钟扫描启用的监控规则。规则满足执行间隔且当前未运行时，执行以下流程：

```text
获取最近帖子
→ 根据 last_seen_post_id 选出新帖子
→ 按发布时间从旧到新排序
→ 逐条调用 AI Matcher
→ matched=true 时发送 Telegram
→ 每条尝试结束后推进 last_seen_post_id
→ 更新 last_checked_at 和 last_error
```

同一个监控规则使用进程内 `Set` 防止重叠执行。

新建规则的第一次正式运行只将当前最新帖子设置为基线，不处理或通知历史内容。

每条帖子完成一次处理尝试后立即推进游标。AI 返回错误、格式错误或 Telegram 发送失败时记录日志和 `last_error`，不重试、不补发。X 请求整体失败时没有取得可确认的新帖子，因此不推进游标。

下一次执行成功后清空 `last_error`。

## 11. AI Matcher 和通知格式

AI Matcher 使用固定系统约束和监控规则的用户 Prompt，要求 OpenAI 兼容接口返回以下 JSON：

```json
{
  "matched": true,
  "message": "Tibo 提到 Codex 将在今晚重置使用额度"
}
```

输入包含帖子的作者、正文、引用帖文字、类型和发布时间。第一阶段不读取图片、视频或外链页面。

当 `matched` 为 `true` 时，程序生成 Telegram 消息：

```text
Tibo 提到 Codex 将在今晚重置使用额度

作者：@username
时间：2026-09-21 20:00
原帖：https://x.com/username/status/...
```

AI 只负责判断和生成简短说明，原帖链接和基础元数据由程序追加。

## 12. 插件设置体验

现有设置页增加“监控服务”菜单。

页面顶部显示：

- 本地服务地址。
- 在线或离线状态。
- 服务版本。
- 手动刷新按钮。

服务在线时显示：

- X Cookie 配置与测试。
- AI 服务列表、模型、API Key 和测试。
- Telegram Bot Token、Chat ID 和测试。
- 发帖／回复 Prompt 模板配置。
- 监控规则列表。

监控规则列表显示规则名称、X 用户、Prompt 摘要、检查间隔、启停状态、最近检查时间和最近错误。支持新增、编辑、删除和立即测试。

服务离线时隐藏 AI、Prompt 和监控编辑区域，显示启动本地服务的提示。Google 和 DeepL 翻译设置保持可用。

`Option.vue` 在加入新页面时按功能拆分组件，至少将本地服务状态、服务端设置和监控列表从现有大文件中独立出来。现有 X 页面逻辑只做支持新 API 所需的调整，不在本阶段全面重写。

## 13. 实施顺序

### 阶段一：服务端基础

- 建立 workspace、`server` 和共享 contracts。
- 实现 Fastify、SQLite、settings、monitors 和 `/health`。
- 实现 X、AI 和 Telegram 配置测试接口。

### 阶段二：监控闭环

- 实现 X Adapter。
- 实现 Scheduler 和游标行为。
- 实现 AI Matcher 和 Telegram Notifier。
- 使用 API 完成一条真实规则的端到端验证。

### 阶段三：插件管理界面

- 实现 `LocalServiceClient` 和 runtime message handlers。
- 增加服务状态、全局配置和监控规则界面。
- 增加立即测试和最近错误展示。

### 阶段四：迁移现有 AI

- 将 AI 服务和 Prompt 配置迁到本地服务。
- 将发帖、回复、聊天和 AI 翻译改为调用本地服务。
- 保留 Google 和 DeepL 的扩展本地实现。
- 实现本地服务离线时的 UI 降级和 AI 翻译回退。

## 14. 最小测试范围

- 使用固定 X 响应样本测试 `XAdapter` 解析。
- 测试新帖筛选、时间排序、首次运行基线和游标推进。
- 测试 AI Matcher 对合法 JSON、非法 JSON 和请求失败的处理。
- 使用模拟 AI 和 Telegram HTTP 服务执行一次完整监控流程。
- 测试 settings 和 monitors API 的基本增删改查。
- 测试服务离线时 Google 和 DeepL 仍可使用，AI 入口正确降级。
- 运行服务端类型检查、测试和扩展正式构建。
- 使用真实 X Cookie、AI 服务和 Telegram 完成一次手动冒烟测试。

## 15. 验收标准

- 本地服务可在 `127.0.0.1:3000` 启动并通过 `/health` 返回状态。
- 用户可从插件配置 X、AI、Telegram 和监控规则。
- 新规则首次运行不会通知历史帖子。
- 后续新帖子会被 AI 按规则 Prompt 判断。
- 命中内容会立即发送 Telegram，未命中内容不会发送。
- 失败只显示日志和最近错误，不产生补发任务。
- 现有 AI 发帖、回复、聊天和 AI 翻译通过本地服务执行。
- 本地服务关闭后，Google 和 DeepL 翻译仍能正常工作。
- 新平台可以通过实现新的 adapter 接入，而不修改 Scheduler、AI Matcher 或 Telegram Notifier。
