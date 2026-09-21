# Fast Social 本地 AI 监控服务实施计划

日期：2026-09-21  
对应设计：`docs/superpowers/specs/2026-09-21-local-ai-monitor-design.md`

## 实施原则

- 以可运行的纵向切片推进，每个阶段都能独立验证。
- 保留现有扩展和 Google／DeepL 翻译，不重写无关功能。
- 本地服务是 AI 配置、AI Prompt、监控规则和自动化的唯一数据源。
- 不引入 Redis、ORM、任务队列、历史记录或补发机制。
- 所有 X 内部接口细节只出现在 X Adapter 中。
- 不把真实 Cookie、API Key 或 Telegram Token 写入代码、fixture、日志或提交。
- 工作区已有未提交修改时，只编辑和暂存当前任务涉及的文件，不覆盖其他改动。

## 任务 1：建立 workspace、本地服务和共享 contracts

### 文件

- 新增 `pnpm-workspace.yaml`
- 修改 `package.json`
- 修改 `.gitignore`
- 新增 `server/package.json`
- 新增 `server/tsconfig.json`
- 新增 `server/src/index.ts`
- 新增 `server/src/app.ts`
- 新增 `server/src/app.test.ts`
- 新增 `shared/contracts/package.json`
- 新增 `shared/contracts/tsconfig.json`
- 新增 `shared/contracts/src/index.ts`

### 步骤

1. 将根项目和 `server`、`shared/contracts` 纳入 pnpm workspace，但不移动现有 `src`。
2. 在根脚本中保留当前扩展的 `dev` 和 `build`，增加：
   - `dev:server`
   - `build:server`
   - `test:server`
   - `check`
3. 服务端使用 Node.js 24+、TypeScript、Fastify、Vitest，并将共享 contracts 作为 workspace 依赖。
4. `createApp()` 只注册 `GET /health`，`index.ts` 负责监听 `127.0.0.1:3000`。
5. `/health` 返回 `{ ok, version, uptimeSeconds, database }` 的共享类型。
6. 将 `server/data/` 加入 `.gitignore`。

### 测试

- 先写 `app.test.ts`，断言注入请求 `/health` 返回 200 和正确结构。
- 运行 `pnpm test:server`。
- 运行 `pnpm build`，确认 workspace 改造没有破坏扩展。

### 建议提交

`build: add local server workspace skeleton`

## 任务 2：定义共享 API 类型和统一错误格式

### 文件

- 修改 `shared/contracts/src/index.ts`
- 新增 `shared/contracts/src/settings.ts`
- 新增 `shared/contracts/src/monitors.ts`
- 新增 `shared/contracts/src/ai.ts`
- 新增 `shared/contracts/src/errors.ts`
- 新增 `shared/contracts/src/social.ts`

### 步骤

1. 定义 `ApiSuccess<T>` 和 `ApiError`，所有 API 使用同一种响应结构。
2. 定义以下共享类型：
   - `HealthResponse`
   - `ServerSettings` 和 `ServerSettingsPatch`
   - `AIServiceConfig`、`AIModelConfig`、`InteractionPrompt`
   - `Monitor`、`CreateMonitorInput`、`UpdateMonitorInput`
   - `MonitorTestResult`
   - `SocialPost`
   - `AIMatchResult`
3. secret 更新字段使用可选值；省略表示保留，字符串表示覆盖。
4. `platform` 第一阶段只允许 `"x"`，但保留联合类型扩展位置。

### 测试

- 对 contracts 执行 TypeScript build。
- 在 server 测试中导入类型，确认 workspace 解析正确。

### 建议提交

`feat: define local service API contracts`

## 任务 3：实现 SQLite、settings 和 monitors repository

### 文件

- 新增 `server/src/db/database.ts`
- 新增 `server/src/db/schema.ts`
- 新增 `server/src/repositories/settings-repository.ts`
- 新增 `server/src/repositories/settings-repository.test.ts`
- 新增 `server/src/repositories/monitor-repository.ts`
- 新增 `server/src/repositories/monitor-repository.test.ts`
- 修改 `server/src/app.ts`

### 步骤

1. 使用 `node:sqlite` 创建一个同步数据库连接。
2. 启动时执行幂等 schema 初始化，只创建：
   - `settings(key, value)`
   - `monitors(...)`
3. `SettingsRepository` 提供按配置分组读取和覆盖更新。
4. `MonitorRepository` 提供列表、新增、更新、删除、更新运行状态和游标。
5. 测试使用 `:memory:` 数据库，不写入真实数据目录。
6. `createApp()` 接收数据库或 repository 依赖，避免测试依赖真实文件。

### 测试

- settings 能保存并合并 AI、Prompt、X 和 Telegram 配置。
- secret patch 省略字段时保留原值。
- monitors CRUD 正确。
- `last_seen_post_id`、`last_checked_at` 和 `last_error` 可独立更新。

### 建议提交

`feat: add sqlite settings and monitor repositories`

## 任务 4：实现配置与监控 CRUD API

### 文件

- 新增 `server/src/routes/settings.ts`
- 新增 `server/src/routes/monitors.ts`
- 新增 `server/src/routes/routes.test.ts`
- 新增 `server/src/http/validation.ts`
- 修改 `server/src/app.ts`

### 步骤

1. 实现：
   - `GET /api/settings`
   - `PUT /api/settings`
   - `GET /api/monitors`
   - `POST /api/monitors`
   - `PUT /api/monitors/:id`
   - `DELETE /api/monitors/:id`
2. 对用户名、Prompt、间隔和 AI 服务配置进行最小运行时校验。
3. 读取 settings 时不返回 secret 明文，只返回 `configured: true/false`。
4. 所有错误使用共享 `ApiError`，日志中不输出请求 body。

### 测试

- 使用 Fastify injection 测试成功路径、缺少字段、非法间隔和不存在 ID。
- 验证更新非 secret 字段不会清空已保存 secret。

### 建议提交

`feat: expose settings and monitor CRUD API`

## 任务 5：实现 X Adapter 和响应 fixture

### 文件

- 新增 `server/src/adapters/social-adapter.ts`
- 新增 `server/src/adapters/x/x-adapter.ts`
- 新增 `server/src/adapters/x/x-client.ts`
- 新增 `server/src/adapters/x/x-operations.ts`
- 新增 `server/src/adapters/x/x-parser.ts`
- 新增 `server/src/adapters/x/x-parser.test.ts`
- 新增 `server/src/adapters/x/__fixtures__/user-timeline.json`
- 新增 `server/src/routes/tests.ts`
- 修改 `server/src/app.ts`

### 步骤

1. 从当前有效的 X 请求确认用户名解析和用户时间线 operation。
2. 保存一份移除 Cookie、用户私密数据和无关字段的响应 fixture。
3. `x-client` 负责 Cookie、CSRF、headers、query variables 和 feature flags。
4. `x-parser` 将 GraphQL 响应转换为 `SocialPost[]`，忽略广告和无法识别的 entry。
5. Adapter 返回原创、回复和转发，并提取引用帖文字。
6. X operation ID 和 feature flags 集中到 `x-operations.ts`，接口变化时只改此模块。
7. 实现 `POST /api/test/x`，返回登录状态、解析出的目标用户和最新帖子摘要。

### 测试

- fixture 能解析帖子 ID、作者、正文、发布时间、URL、引用文字和类型。
- 空时间线、置顶帖、已删除帖和未知 entry 不导致整个请求失败。
- 无 Cookie、缺少 CSRF、401 和响应结构变化返回清晰错误。

### 人工验证

- 用户在本地设置真实 Cookie。
- 调用 `/api/test/x`，确认能读取指定公开用户的最新帖子。

### 建议提交

`feat: add direct X timeline adapter`

## 任务 6：实现 AI Gateway、Matcher 和 Telegram Notifier

### 文件

- 新增 `server/src/ai/ai-gateway.ts`
- 新增 `server/src/ai/openai-compatible-client.ts`
- 新增 `server/src/ai/ai-matcher.ts`
- 新增 `server/src/ai/ai-matcher.test.ts`
- 新增 `server/src/telegram/telegram-notifier.ts`
- 新增 `server/src/telegram/telegram-notifier.test.ts`
- 修改 `server/src/routes/tests.ts`

### 步骤

1. 将现有 OpenAI 兼容调用能力迁移为服务端 `AI Gateway`。
2. Gateway 根据 `serviceId:modelName` 解析服务和模型，并支持普通与流式请求。
3. Matcher 组合固定系统约束、监控 Prompt 和 `SocialPost`，要求返回 `{ matched, message }`。
4. Matcher 严格解析 JSON；无法解析时作为本次 AI 错误，不尝试猜测结果。
5. Telegram Notifier 使用 Bot API `sendMessage`，程序追加作者、时间和原帖链接。
6. 实现 `POST /api/test/ai` 和 `POST /api/test/telegram`。
7. 所有客户端接收可注入的 `fetch`，便于测试且不请求真实服务。

### 测试

- AI 合法 JSON、markdown code fence JSON、非法 JSON、HTTP 错误和空响应。
- Telegram 请求 URL、chat ID 和消息文本正确。
- 测试接口不改变 monitor 数据。

### 建议提交

`feat: add AI matcher and Telegram notifier`

## 任务 7：实现 Monitor Runner 和 Scheduler

### 文件

- 新增 `server/src/monitor/monitor-runner.ts`
- 新增 `server/src/monitor/monitor-runner.test.ts`
- 新增 `server/src/monitor/scheduler.ts`
- 新增 `server/src/monitor/scheduler.test.ts`
- 修改 `server/src/routes/monitors.ts`
- 修改 `server/src/index.ts`

### 步骤

1. Runner 获取时间线并根据 `last_seen_post_id` 过滤新帖。
2. 新帖按发布时间从旧到新处理。
3. `last_seen_post_id` 为空时，只保存当前最新 ID，不调用 AI 和 Telegram。
4. 每条帖子完成一次处理尝试后推进游标；AI 或 Telegram 失败不重试。
5. X 整体请求失败时不推进游标。
6. 规则执行结束时更新 `last_checked_at`；有错误则保存 `last_error`，完整成功则清空。
7. Scheduler 每分钟扫描到期规则，并用进程内 `Set<string>` 防止同一规则重叠。
8. 实现 `POST /api/monitors/:id/run`：测试最新一条帖子，只返回 AI 结果，不发 Telegram、不改游标。

### 测试

- 首次运行只建立基线。
- 多条新帖按正确顺序处理。
- matched=false 不发送 Telegram。
- matched=true 发送一次 Telegram。
- AI／Telegram 失败会推进对应帖子游标并保存错误。
- X 请求失败不推进游标。
- 重叠任务被跳过。
- 手动测试不产生任何数据库副作用。

### 人工验证

- 使用真实配置创建一条低频规则。
- 通过临时 Prompt 匹配最新测试内容，确认 Telegram 收到消息。

### 建议提交

`feat: run scheduled AI post monitors`

## 任务 8：增加插件 LocalServiceClient 和后台消息路由

### 文件

- 修改 `manifest.config.ts`
- 新增 `src/common/local-service-messages.ts`
- 新增 `src/background/local-service-client.ts`
- 新增 `src/background/handlers/local-service.ts`
- 修改 `src/common/runtime-message.ts`
- 修改 `src/background/index.ts`
- 新增 `src/background/local-service-client.test.ts`

### 步骤

1. manifest 增加 `http://127.0.0.1:3000/*` host permission。
2. `LocalServiceClient` 统一 base URL、超时、JSON 解析和 API 错误转换。
3. 设置页和 content script 继续使用 `chrome.runtime.sendMessage`，不直接 fetch localhost。
4. 增加 health、settings、monitor CRUD、test 和 run 的 runtime message 类型及 handlers。
5. `background/index.ts` 只注册 handlers；具体 localhost 逻辑移出大型 switch。
6. 服务未启动、超时或返回非 JSON 时转换为明确的 `LOCAL_SERVICE_UNAVAILABLE`。

### 测试

- 模拟 fetch 测试在线、离线、超时、HTTP 错误和无效 JSON。
- 运行 `pnpm build`，确认 MV3 service worker 可编译。

### 建议提交

`feat: connect extension to local service`

## 任务 9：实现插件监控服务设置界面

### 文件

- 新增 `src/pages/option/components/LocalServiceStatus.vue`
- 新增 `src/pages/option/components/ServerSettings.vue`
- 新增 `src/pages/option/components/MonitorList.vue`
- 新增 `src/pages/option/components/MonitorDialog.vue`
- 新增 `src/pages/option/composables/useLocalService.ts`
- 修改 `src/pages/option/Option.vue`

### 步骤

1. 设置页增加“监控服务”菜单。
2. 页面加载时检查 `/health`，显示在线状态、版本和刷新按钮。
3. 服务在线时显示 X、AI、Telegram、Prompt 和监控规则配置。
4. 服务离线时只显示启动提示，不渲染 AI 与监控编辑表单。
5. 监控列表支持新增、编辑、删除、启停和立即测试。
6. 测试结果弹窗显示最新原文、`matched`、`message`，不发送 Telegram。
7. 保存 secret 时空输入表示保留原值，显式“清除”操作才发送空值。
8. 保留现有基础翻译设置，不移动 Google 或 DeepL 配置。

### 测试

- 对 composable 的在线、离线和 API 错误状态做最小单元测试。
- 手动验证新增、编辑、删除、测试和服务离线界面。
- 运行 `pnpm build`。

### 建议提交

`feat: manage local monitors from extension`

## 任务 10：将现有 AI 与 Prompt 迁移到本地服务

### 文件

- 修改 `server/src/routes/settings.ts`
- 新增 `server/src/routes/ai.ts`
- 新增 `server/src/routes/ai.test.ts`
- 修改 `src/common/storage-config.ts`
- 修改 `src/common/runtime-message.ts`
- 修改 `src/background/index.ts`
- 修改 `src/utils/ai.ts`
- 修改 `src/utils/translate.ts`
- 修改 `src/components/social/_twitter.ts`
- 修改 `src/components/ui/Chat.vue`
- 修改 `src/pages/option/Option.vue`
- 修改 `src/pages/popup/Popup.vue`

### 步骤

1. 服务端实现：
   - `GET /api/ai/options`
   - `GET /api/prompts`
   - `POST /api/ai/chat`
2. 普通请求返回完整结果；流式请求将上游 chunk 原样转换为稳定的服务端 stream 格式。
3. extension service worker 将 stream chunk 转发给现有标签页消息，不要求 Chat 和页面组件直接 fetch。
4. AI 服务、模型、API Key 和发帖／回复 Prompt 从 Chrome storage 配置结构中移除。
5. 插件启动或 X 页面初始化时从本地服务读取启用的 Prompt；不写入离线缓存。
6. 服务离线时：
   - 不注入 AI 发帖／回复快捷按钮。
   - Chat 显示服务离线状态并禁止发送。
   - 设置页隐藏 AI 配置编辑。
7. AI 翻译请求本地服务失败时，调用现有 Google／DeepL 自动翻译流程，并向 UI 返回 `degraded: true`。
8. Google、DeepL、目标语言和自动翻译配置继续使用 Chrome storage。
9. 对旧版 Chrome storage 做兼容读取，但不再使用或写回其中的 AI secret 和 AI 服务列表。

### 测试

- 服务端普通和流式 AI 请求。
- Prompt 在线加载和服务离线时不显示。
- Chat 在线可流式输出，离线不可发送。
- AI 翻译离线时降级，Google／DeepL 直接模式完全不依赖服务。
- 运行 `pnpm check`。

### 建议提交

`refactor: move extension AI capabilities to local service`

## 任务 11：端到端验收和运行文档

### 文件

- 修改 `README.md`，仅在保留用户现有内容的基础上补充新章节
- 新增 `server/README.md`

### 步骤

1. 文档说明 Node 版本、安装、启动服务、构建扩展和加载扩展的方法。
2. 服务启动时自动创建被 git 忽略的 `server/data/` 目录。
3. 文档说明如何从浏览器开发者工具取得用于本机请求的 X Cookie，但不展示真实凭证。
4. 文档说明如何创建 Telegram Bot、取得 Chat ID，并填写本地设置。
5. 增加常见错误：服务离线、Cookie 失效、X operation 变化、AI JSON 无效和 Telegram 配置错误。
6. 按设计文档的验收标准执行一次完整检查。

### 最终验证

```bash
pnpm install
pnpm test:server
pnpm build:server
pnpm build
```

人工检查：

1. 本地服务在线，插件显示正确版本。
2. X、AI、Telegram 三个测试按钮成功。
3. 新建规则首次运行不通知历史帖子。
4. 新帖子未命中时不通知。
5. 新帖子命中时 Telegram 收到一次通知。
6. 关闭本地服务后，AI 入口降级，Google 和 DeepL 仍正常。

### 建议提交

`docs: document local service setup and verification`

## 完成定义

以下条件全部满足时，第一阶段完成：

- 设计文档中的验收标准全部通过。
- 服务端测试、类型检查和扩展构建通过。
- 没有真实凭证进入 git diff 或日志 fixture。
- 本地服务关闭时，Google 和 DeepL 翻译仍可用。
- X Adapter、AI Gateway、Telegram 和插件 API 边界均可独立替换。
