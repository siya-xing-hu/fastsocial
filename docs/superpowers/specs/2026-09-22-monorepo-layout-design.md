# Fast Social Monorepo 目录重构设计

日期：2026-09-22

## 背景

Fast Social 目前同时包含浏览器插件、本地服务端和两端共享的 TypeScript 类型，但插件源码与构建配置仍位于仓库根目录。根 `package.json` 既是插件包，又承担 workspace 编排职责；扩展产物直接输出到根 `dist/`；服务端的 `build` 目前只执行类型检查，没有生成可直接运行的构建产物。

本次调整将仓库整理为轻量 pnpm monorepo，让插件和服务端成为边界清晰、可分别开发和构建的应用，同时保留一个极薄的共享 API 契约包。

## 目标

- 插件与服务端的源码、配置、依赖和命令分别位于自己的子项目目录。
- 每个子项目都能在自己的目录内执行 `dev`、`build` 和 `test`。
- 根目录只承担项目说明、workspace 配置、版本约束和统一命令编排，不再承载应用源码或应用依赖。
- 全仓继续使用一个 `pnpm-lock.yaml`，每个模块只声明自己的直接依赖。
- 插件和服务端的构建产物统一输出到根 `dist/` 下的独立目录。
- 服务端构建后生成可通过 `node dist/server/index.js` 启动的 JavaScript 产物。
- SQLite 数据与构建产物分离，清理或重建 `dist/` 不影响个人配置。

## 非目标

- 不拆分多个 Git 仓库。
- 不为公共代码建立 UI 组件库或通用工具库。
- 不发布 npm 包。
- 不引入 Docker、部署系统或生产级进程管理。
- 不改变现有监控、AI、Telegram 和翻译功能的业务行为。
- 不在本次目录迁移中扩大安全、重试或历史记录等 MVP 范围。

## 目录结构

```text
fastsocial/
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   ├── package.json
│   │   ├── manifest.config.ts
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.cjs
│   │   ├── .env.development
│   │   └── .env.production
│   └── server/
│       ├── src/
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
├── packages/
│   └── contracts/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── dist/                       # 生成目录，不提交 Git
│   ├── extension/              # Chrome 可直接加载
│   └── server/
│       └── index.js            # Node 24 可直接运行
├── .data/                      # SQLite 等本地运行数据，不提交 Git
├── docs/
├── package.json                # 仅统一脚本和版本约束
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── .tool-versions
├── .gitignore
└── README.md
```

根目录仍需保留 lockfile、workspace、Git 和 Node 版本等仓库级配置；“根目录不放代码”指不再放任何应用源码和应用专属构建配置。

## 模块职责

### `apps/extension`

包含当前根 `src/`、Chrome manifest、Vite、Vue、Tailwind、PostCSS、TypeScript 配置和 Vite 环境文件。它负责：

- X 页面注入、翻译和交互 UI。
- Popup 与设置页。
- 通过 service worker 访问 `127.0.0.1` 本地服务。
- 在服务端不可用时继续保留 Google/DeepL 基础翻译能力。

包名调整为 `@fast-social/extension`。Vue、Vite、CRX、Tailwind 和插件使用的运行时依赖全部由该包声明。

### `apps/server`

包含 Fastify API、SQLite、调度器、X adapter、AI gateway 和 Telegram 通知。Fastify、Node 类型、数据库及服务端构建工具全部由该包声明。

开发阶段继续直接运行 TypeScript；生产构建使用 esbuild 将服务端入口和运行时依赖打成单个 ESM 文件，避免 `dist/server` 无法解析 `apps/server/node_modules`。产物目标为 Node 24，不做浏览器兼容或旧版 Node 转译。

### `packages/contracts`

保留 `@fast-social/contracts`，但明确它是共享 API 契约，不是“公共组件”模块。它只包含：

- HTTP 请求和响应 DTO。
- `Monitor`、`ServerSettings`、`SocialPost` 等两端需要保持一致的类型。
- API 成功和错误响应结构。

它不包含 UI、数据库实现、网络客户端、业务逻辑或一般工具函数。当前内容均为 type-only，因此 `build` 只需执行类型检查，不产生单独运行时产物。只有未来加入运行时 schema 时，才考虑编译该包。

## 依赖管理

`pnpm-workspace.yaml` 使用：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

依赖遵循以下规则：

1. 每个模块在自己的 `package.json` 声明全部直接依赖。
2. 插件和服务端都通过 `"@fast-social/contracts": "workspace:*"` 使用契约包。
3. 根 `package.json` 不保留 Vue、Fastify 或 TypeScript 等应用依赖；它只保留 `private`、`packageManager`、Node engine 和统一脚本。
4. 全仓只保留根 `pnpm-lock.yaml`，子项目不创建自己的 lockfile。
5. pnpm 可以在磁盘层复用依赖，但这不改变模块必须显式声明直接依赖的原则。

暂不建立 `packages/ui`、`packages/utils` 或共享配置包。只有出现第二个真实消费者时再抽取，避免个人项目被过度模块化。

## 命令设计

插件目录支持：

```bash
cd apps/extension
pnpm dev
pnpm build
pnpm test
```

服务端目录支持：

```bash
cd apps/server
pnpm dev
pnpm build
pnpm test
pnpm start
```

其中服务端 `start` 运行已构建的 `../../dist/server/index.js`。根目录提供对应的统一入口：

```bash
pnpm dev:extension
pnpm dev:server
pnpm build:extension
pnpm build:server
pnpm build
pnpm check
pnpm start:server
```

根命令只通过 pnpm filter 调用子模块脚本，不复制具体构建逻辑。

## 构建产物

### 插件

Vite `outDir` 设置为根 `dist/extension`。`emptyOutDir` 只清理该目录，不能清理整个根 `dist/`。最终目录以 `manifest.json` 为入口，可直接作为 Chrome 的“加载已解压的扩展程序”目录。

### 服务端

服务端构建分两步：

1. TypeScript 严格类型检查。
2. 使用 esbuild 生成 `dist/server/index.js`，并将 Fastify 等运行时依赖打入产物。

构建不包含测试文件、SQLite 数据库或本地密钥。bundle 保持 source map，方便个人项目排查问题；不要求压缩。

### 本地数据

SQLite 默认放在根 `.data/`，并支持通过 `FAST_SOCIAL_DATA_DIR` 覆盖。服务端在源码开发模式和构建产物模式下必须解析到同一数据目录。`.data/` 和 `dist/` 都加入 `.gitignore`。

构建、清理或重新加载插件均不得删除 `.data/`。

## 数据流与模块边界

目录变化不改变现有运行链路：

```text
Chrome 页面
  → extension content script / UI
  → extension service worker
  → http://127.0.0.1:3000
  → server Fastify API
  → SQLite / X / AI / Telegram
```

`contracts` 仅在编译期约束 extension 与 server 之间的数据结构，不参与运行时请求，也不允许任一应用直接导入另一个应用的源码。

## 错误处理

- 子项目命令失败时必须以非零状态退出，根编排脚本立即失败。
- 服务端启动时如果数据目录无法创建或数据库无法打开，直接报告明确错误并退出。
- 插件构建与服务端构建分别清理自己的输出目录，避免一个构建删除另一个构建的结果。
- 目录迁移后，本地服务不可用时插件仍按现有逻辑降级到 Google/DeepL；目录调整不能改变这一行为。

## 迁移策略

1. 先为当前已完成但尚未提交的功能建立独立检查点，避免功能实现与纯目录迁移混在同一个提交中。
2. 使用 `git mv` 将插件文件移动到 `apps/extension`、服务端移动到 `apps/server`、契约包移动到 `packages/contracts`，尽量保留文件历史。
3. 拆分当前根 `package.json`：插件依赖迁入 extension；根包改名为 `fast-social` 并只保留编排脚本。
4. 更新 workspace glob、构建输出路径、Vite 输入、Tailwind 扫描路径、TypeScript 配置和文档命令。
5. 将 `.tool-versions` 从当前 Node 18.19 统一为 Node 24，与服务端 `engines` 和 `node:sqlite` 要求一致。
6. 重新执行 `pnpm install`，刷新 lockfile 的 importer 和 workspace link 路径。
7. 分别从两个应用目录执行测试和构建，再运行根 `pnpm check`。

## 验证与验收标准

迁移完成必须满足：

- 根目录不存在应用源码目录 `src/`，也不存在插件专属构建配置。
- `cd apps/extension && pnpm test && pnpm build` 成功，产物位于 `dist/extension`。
- `cd apps/server && pnpm test && pnpm build` 成功，产物位于 `dist/server/index.js`。
- `node dist/server/index.js` 能启动服务，`GET /health` 返回成功。
- `cd packages/contracts && pnpm build` 类型检查成功。
- 根 `pnpm check` 覆盖 contracts、server 和 extension。
- Chrome 能从 `dist/extension` 加载插件。
- 服务端停止时，插件 Google/DeepL 翻译仍可使用，AI 功能正确显示不可用状态。
- 迁移前的本地 SQLite 数据不会因构建或清理 `dist/` 被删除。
- 仓库只有一个 `pnpm-lock.yaml`，每个应用只声明自己的直接依赖。

## 选择结论

采用 `apps/* + packages/*` 的标准轻量 monorepo，而不是将 extension、server 平铺在根目录，也不将类型复制到两端。该结构多一层目录，但能清楚表达“可运行应用”和“共享契约”的区别，也为以后增加其他英文社区 adapter 或独立管理界面保留自然扩展空间。
