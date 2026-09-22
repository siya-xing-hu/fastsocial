# Fast Social Option 二级设置页面设计

日期：2026-09-22

## 1. 背景

Fast Social 当前把插件本地翻译配置、本地服务连接状态、AI 服务、X 与 Telegram 凭证、互动 Prompt 和用户监听集中展示在同一个 Option 页面中。功能已经可用，但所有服务端配置连续堆叠，页面较重，也不容易区分：

- 哪些能力属于插件，服务端关闭后仍然可用；
- 哪些配置属于本地服务；
- 当前还缺少什么必要配置；
- 哪些位置用于配置、执行操作和查看结果。

现阶段是个人项目并处于快速迭代期，不需要新建独立管理站点，也不再引入 Side Panel。继续使用 Chrome Option 页面，通过一级横向导航和服务端二级纵向导航整理现有能力。

## 2. 目标

- 使用一个 Option 页面管理插件和本地服务配置。
- 用横向一级导航清晰区分“插件基础设置”和“服务端设置”。
- 在“服务端设置”中使用纵向二级导航展示不同配置列表。
- AI 服务、用户监听和互动 Prompt 都以列表为主，新增和编辑使用弹窗。
- 服务端离线时，Google 和 DeepL 等插件基础能力及其配置页仍然可用。
- 增加浏览器快捷键，在扩展重载导致 Option 页面关闭后可以立即重新打开。
- 复用现有服务端 API 和共享 contracts，不为页面重排增加新的服务端数据模型。
- 拆分当前较大的 `Option.vue`，让页面结构和业务状态边界清晰，但不引入新的前端框架或路由库。

## 3. 非目标

本次不实现：

- Chrome Side Panel。
- 独立的服务端 Web 管理页面。
- 帖子历史、AI 执行历史、Telegram 发送历史或通知补发。
- 多用户、登录、权限和远程访问安全设计。
- 新的后端 CRUD 体系；AI 服务和互动 Prompt 仍通过整体 settings 读写。
- 为 Option 页面引入 Vue Router、全局状态库或新的 UI 组件库。
- 重做 Popup、内容脚本或 X 页面中的交互能力。

## 4. 信息架构

### 4.1 一级横向导航

Option 页面头部下方显示两个横向标签：

1. **插件基础设置**
2. **服务端设置**

一级导航表达配置的所有权，而不是功能分类：

| 页面 | 数据所有者 | 服务端离线时 |
|---|---|---|
| 插件基础设置 | `chrome.storage.local` | 正常查看和修改 |
| 服务端设置 | `127.0.0.1:5127` + SQLite | 显示离线状态，不能读取或保存 |

### 4.2 插件基础设置

基础设置保持为单页，包含：

- 翻译服务：自动、Google、DeepL、AI。
- 目标语言。
- DeepL API 地址和 API Key。
- Google 失败后的 DeepL 回退时间。
- 自动翻译开关。
- AI 翻译 Prompt。

页面顶部明确显示“保存在浏览器本地，服务端关闭后 Google / DeepL 仍可使用”。

为保持行为简单，基础设置继续使用现有浏览器存储方法。界面提供明确的保存反馈；具体实现可以继续复用已有的防抖保存，不改变数据格式。

### 4.3 服务端二级纵向导航

进入“服务端设置”后，左侧显示以下纵向菜单：

1. **配置概览**
2. **连接配置**
3. **AI 服务**
4. **用户监听**
5. **互动 Prompt**

窄屏下纵向菜单改为顶部可横向滚动的二级标签，内容区域保持单列，避免固定侧栏挤压表单。

#### 配置概览

概览不是事件仪表盘，只回答“现在能不能用”和“还缺什么”：

- 本地服务地址和在线状态。
- 已配置的 AI 服务数量。
- 已启用的用户监听数量。
- X Cookie、默认 AI 服务与模型、Telegram 配置的完成状态。
- 对缺失项提供“去配置”，直接跳到对应二级页面。

不展示帖子、AI 判断或 Telegram 发送记录。

#### 连接配置

包含两个配置卡片：

- X：Cookie、测试用户名、“测试 X”。
- Telegram：Bot Token、Chat ID、“发送测试消息”。

Secret 使用现有语义：服务端只返回 `...Configured`；输入留空表示保留原值，输入新值表示覆盖。

#### AI 服务

主区域使用列表展示 AI 服务，每行显示：

- 名称。
- Endpoint。
- 模型名称摘要。
- API Key 是否已配置。
- 是否启用。
- 是否为默认服务 / 模型。
- 编辑、删除和测试操作。

“添加 AI 服务”和“编辑”打开同一个弹窗。弹窗只包含第一阶段必要字段：

- 服务名称。
- OpenAI 兼容 API 地址。
- 模型列表。
- API Key。
- 是否启用。

列表下方设置默认服务与默认模型。保存后，同一服务 ID 的新配置直接覆盖原配置，现有监听无需复制 API Key 或迁移记录。

AI 服务仍通过 `GET /api/settings` 和 `PUT /api/settings` 整体读取、更新；“测试 AI”继续调用 `POST /api/test/ai`，本次不新增单服务 CRUD API。

#### 用户监听

主区域使用列表展示监听规则，每行显示：

- 规则名称和 X 用户名。
- 执行间隔。
- 启用 / 暂停状态。
- Prompt 摘要。
- 最近检查时间或最近错误，仅显示当前状态，不形成历史列表。
- 立即检查、编辑、删除操作。

“新建监听”和“编辑”使用同一个弹窗，字段包括名称、X 用户名、判断 Prompt、间隔和启用状态。

数据继续使用现有接口：

- `GET /api/monitors`
- `POST /api/monitors`
- `PUT /api/monitors/:id`
- `DELETE /api/monitors/:id`
- `POST /api/monitors/:id/run`

“立即检查”只展示该次调用的成功结果或错误，不保存帖子或 AI 执行历史。

#### 互动 Prompt

互动 Prompt 以列表展示名称、使用场景、启用状态和 Prompt 摘要。新增和编辑使用弹窗，支持 `post` 与 `reply` 两种场景。

这些模板只负责定义 X 页面中发帖 / 回复的 AI 快捷操作；实际 AI 调用仍由服务端执行。服务端离线时，内容脚本中的 AI 入口继续隐藏或禁用。

互动 Prompt 继续作为 `ServerSettings.interactionPrompts` 的一部分通过 settings API 整体保存。

## 5. 页面状态和导航

不引入 Vue Router。使用轻量页面状态：

```ts
type PrimaryPage = "basic" | "server";
type ServerPage = "overview" | "connections" | "ai" | "monitors" | "prompts";
```

选中项同步到 URL hash，例如：

```text
#basic
#server/overview
#server/ai
#server/monitors
```

同时把最后一次有效路径保存到 Option 页自己的 `localStorage`。初始化时 URL hash 优先；没有 hash 时读取保存路径；两者都无效时回退到默认页面。这样可以：

- 浏览器刷新后回到原页面；
- 概览中的“去配置”直接切换到准确位置；
- 扩展重载关闭 Option 后，通过快捷键重新打开时恢复最近一次访问的页面；
- 不增加路由依赖。

无法识别的 hash 回退到 `#basic`。第一次进入服务端设置默认打开 `overview`。该导航记录不属于业务配置，不需要同步到服务端或共享 contracts。

## 6. 服务状态与离线降级

### 6.1 状态呈现

页面头部显示紧凑的本地服务状态：

- 绿色：已连接。
- 黄色或灰色：未启动 / 无法连接。
- 刷新中：仅禁用依赖服务端的操作，不阻塞基础设置。

服务端状态不使用覆盖整个页面的全局弹窗，也不把 Option 页面替换成单独错误页。

### 6.2 离线行为

服务端离线时：

- “插件基础设置”完全可用。
- “服务端设置”的导航仍然可见。
- 内容区显示“服务未启动”和启动命令 `pnpm dev:server`。
- 服务端列表和保存 / 测试按钮不可用，不展示伪造或过期配置。
- 用户可以手动刷新连接状态。
- X 页面上的 AI 能力继续按现有策略隐藏或降级；Google / DeepL 不受影响。

成功连接后一次并行加载 settings 和 monitors。任一请求失败时保留已成功的数据，并在对应页面显示错误，而不是让整个 Option 页面失效。

## 7. 配置、操作和结果的视觉规则

为了让页面一眼可读，所有二级页面遵守同一模式：

- **配置**：列表、表单和弹窗位于页面主体。
- **操作**：新增操作放在页面标题右侧；测试、编辑、删除放在对应配置旁边。
- **结果**：用轻量状态标签和就地提示展示，不新增事件流或日志页。

状态标签使用统一含义：

- 绿色：已连接、可用、已启用。
- 黄色：待配置、缺少必要字段。
- 灰色：备用、暂停或未知。
- 红色：当前操作失败或最近一次检查失败。

删除操作需要二次确认；保存、测试和立即检查期间只禁用相关按钮，避免阻塞其他页面。

## 8. 快捷键重新打开 Option

扩展 manifest 增加一个命令：

```text
open-options
```

建议快捷键：

```text
Alt+Shift+F
```

Manifest 使用标准组合 `Alt+Shift+F`；在 macOS 中界面显示为 `⌥ ⇧ F`。用户可以在 `chrome://extensions/shortcuts` 中重新绑定，避免与本机其他软件冲突。

扩展 service worker 监听 `chrome.commands.onCommand`，收到 `open-options` 后调用：

```ts
chrome.runtime.openOptionsPage();
```

该方案不需要 Side Panel 权限，也不增加新的页面入口。扩展重载后 service worker 会重新注册监听器，用户按快捷键即可重新打开 Option。现有 Popup 中的 “Options” 入口继续作为备用入口。

## 9. 前端代码结构

当前 `apps/extension/src/pages/option/Option.vue` 同时包含全部模板、状态、API 操作、弹窗和样式。改造后保留它作为页面壳，建议拆分为：

```text
apps/extension/src/pages/option/
├─ Option.vue                         # 页面壳、一级导航、全局提示
├─ option-navigation.ts               # hash 解析与导航类型
├─ use-server-admin.ts                # 在线状态、settings/monitors、API 操作
├─ components/
│  ├─ BasicSettings.vue               # 插件本地设置
│  ├─ ServerSettings.vue              # 二级导航与服务端内容壳
│  └─ server/
│     ├─ OverviewPanel.vue
│     ├─ ConnectionPanel.vue
│     ├─ AIServicePanel.vue
│     ├─ MonitorPanel.vue
│     ├─ InteractionPromptPanel.vue
│     ├─ AIServiceDialog.vue
│     └─ MonitorDialog.vue
├─ option.html
└─ option.ts
```

职责边界：

- `Option.vue` 不直接实现 AI 服务或监听 CRUD。
- `BasicSettings.vue` 只访问 `storage-config.ts`，不请求本地服务。
- `use-server-admin.ts` 统一持有服务在线状态、settings、monitors、loading、saving 和错误，并复用现有 `requestLocalService()`。
- 各 Panel 只渲染自身领域并调用 composable 暴露的操作。
- Dialog 维护编辑草稿；点击保存后才更新 settings 或调用监控接口，取消不会污染列表数据。
- 共享 contracts 不增加 UI 状态字段。

组件仍使用现有 Vue 3、Tailwind 和 Headless UI 能力，不增加依赖。第一阶段不抽取新的公共 UI package；这些组件只服务扩展 Option 页面，跨项目复用价值不足。

## 10. 数据流

### 10.1 页面初始化

```text
读取 URL hash
→ 初始化插件本地配置
→ 请求 /health
→ 在线时并行请求 /api/settings 与 /api/monitors
→ 渲染当前一级和二级页面
```

### 10.2 修改 AI 服务或互动 Prompt

```text
打开弹窗并复制编辑草稿
→ 本地校验必填字段
→ 更新内存中的 ServerSettings
→ PUT /api/settings
→ 使用服务端返回值替换本地 settings
→ 就地显示保存结果
```

Secret 输入为空时从请求中省略，不用空字符串覆盖已保存的 Key。

不同二级页面只提交自身分区，避免未加载的空数据覆盖其他配置：

```ts
// 连接配置
{ x, telegram }

// AI 服务；一旦提供 ai，内部字段必须完整
{ ai: { services, defaultProvider } }

// 互动 Prompt；数组整体替换
{ interactionPrompts }
```

删除当前默认 AI 服务或默认模型时，同一次更新中清空 `defaultProvider`，要求用户重新选择。X、AI、Telegram 的测试操作先保存对应分区，再调用测试接口；不再依赖整页统一保存。

### 10.3 修改监听

```text
打开弹窗并复制编辑草稿
→ 本地校验
→ POST 或 PUT monitor API
→ 用返回结果更新列表
→ 就地显示保存结果
```

启用开关也是一次 `PUT /api/monitors/:id`，不新增专用接口。

## 11. 错误处理

- 服务不可达统一识别为 `LOCAL_SERVICE_UNAVAILABLE`，头部状态切换为离线。
- 表单校验错误显示在对应字段附近。
- API 错误在当前页面顶部或当前行就地显示。
- 测试 X、AI、Telegram 和立即检查的结果不写入历史记录。
- 保存失败时保留弹窗草稿，用户可以修改后重试。
- 删除失败时保留列表项。
- 不实现重试队列、自动补发或复杂恢复流程。

## 12. 验证方案

### 自动验证

- 为 `option-navigation.ts` 增加 hash 解析和非法值回退测试。
- 保留并运行 `LocalServiceClient` 的请求、超时和错误测试。
- 如将服务端管理逻辑抽成纯函数，为 AI 服务 / Prompt 草稿合并与 secret 保留规则增加测试。
- 运行 `pnpm check`，覆盖 contracts 构建、扩展测试、服务端测试和两端构建。

### 手动验收

- 一级横向导航和服务端二级导航切换正确，刷新后保持当前位置。
- 基础设置修改后，扩展重载仍能读取，服务端关闭时仍可使用 Google / DeepL。
- 服务端离线时只影响服务端页面和 AI 能力，不阻塞整个 Option。
- AI 服务可以通过列表新增、编辑、删除、启用、设置默认值和测试。
- X、Telegram 配置可以保存和测试，留空 Secret 不会清除已保存值。
- 用户监听可以新增、编辑、启停、删除和立即检查。
- 互动 Prompt 可以新增、编辑、启停和删除。
- 扩展重载导致 Option 关闭后，`Alt+Shift+F` 可以重新打开；Popup 的 Options 入口仍有效。
- 在 320px 宽度下二级菜单可横向滚动，表单和弹窗没有横向溢出。

## 13. 实施边界

本次改造优先复用现有后端和 contracts，主要变化集中在扩展：

- 重构 Option 页面结构和样式。
- 拆分 Vue 组件和服务端管理状态。
- 增加 hash 导航。
- 在 manifest 和 background 中增加打开 Option 的快捷键。
- 增加与导航、快捷键和状态降级相关的测试。

若实现过程中发现现有 API 无法完成页面需要，优先调整前端交互；只有缺少必要数据或操作时才扩展服务端接口。
