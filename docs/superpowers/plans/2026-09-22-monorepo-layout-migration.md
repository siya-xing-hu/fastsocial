# Fast Social Monorepo 目录迁移实施计划

日期：2026-09-22  
依据：[Monorepo 目录重构设计](../specs/2026-09-22-monorepo-layout-design.md)

## 实施原则

- 只调整目录、构建和运行入口，不改变产品功能。
- 保留用户已有的 README 修改，不把它混入功能检查点提交。
- 先保存当前本地 AI 监控功能，再单独完成目录迁移。
- 所有模块继续使用同一 pnpm workspace 与根 lockfile。
- 每一步都可通过测试或构建验证，不在最后一次性排错。

## 任务 1：建立当前功能检查点

1. 使用 Node 24 运行现有 `pnpm check`。
2. 复核工作树，只暂存本次已完成的本地服务、共享契约和插件接入文件。
3. 保留 README 的既有未提交修改。
4. 提交当前功能，提交信息为 `feat: add local AI monitor service`。

验收：功能提交与目录迁移提交可以独立查看，README 的用户修改仍保留在工作树中。

## 任务 2：移动源码和应用配置

1. 创建 `apps/extension`、`apps/server` 与 `packages/contracts`。
2. 将根 `src/` 及插件专属配置移动到 `apps/extension`：
   - `manifest.config.ts`
   - `vite.config.ts`
   - `tsconfig.json`
   - `tailwind.config.js`
   - `postcss.config.cjs`
   - `.env.development`
   - `.env.production`
3. 将 `server/` 移动到 `apps/server/`。
4. 将 `shared/contracts/` 移动到 `packages/contracts/`。
5. 将现有 `server/data/fastsocial.db` 移到根 `.data/fastsocial.db`，不删除已有数据。

验收：根目录不再包含应用 `src/` 或插件专属构建配置，源码全部位于对应模块。

## 任务 3：拆分 package 与 workspace 配置

1. 新建 `apps/extension/package.json`，迁入当前插件脚本及依赖，包名改为 `@fast-social/extension`。
2. 将根 `package.json` 改为 `fast-social` 编排包，只保留 workspace 级命令、Node engine 和 package manager。
3. 更新 `pnpm-workspace.yaml` 为 `apps/*` 与 `packages/*`。
4. 保持两端使用 `@fast-social/contracts: workspace:*`。
5. 更新 `.tool-versions` 为 Node 24。
6. 更新 `.gitignore`，忽略 `dist/`、`.data/` 与本地依赖目录。
7. 运行 `pnpm install` 刷新 lockfile importer 和 workspace 链接。

验收：在任一子模块运行 pnpm 都能识别根 workspace，仓库仍只有一个 lockfile。

## 任务 4：配置插件独立构建

1. 将 Vite 输出目录设置为 `../../dist/extension`。
2. 显式设置 `emptyOutDir: true`，只清理插件自己的产物目录。
3. 确认 manifest 从 `apps/extension/package.json` 读取版本。
4. 确认 Vite HTML input、manifest 源文件、Tailwind content 和环境文件均按子项目目录解析。
5. 将插件测试脚本改为子项目内相对路径。

验收：在 `apps/extension` 内运行 `pnpm test && pnpm build` 成功，`dist/extension/manifest.json` 存在。

## 任务 5：配置服务端可运行构建

1. 在 `apps/server` 添加 esbuild 开发依赖。
2. 将服务端 `build` 定义为类型检查后 bundle：
   - 平台：Node
   - 格式：ESM
   - 目标：Node 24
   - 入口：`src/index.ts`
   - 输出：`../../dist/server/index.js`
   - 包含运行时依赖并生成 source map
3. 将 `start` 改为运行 `../../dist/server/index.js`。
4. 数据目录优先读取 `FAST_SOCIAL_DATA_DIR`；在仓库内运行时默认使用根 `.data/`。
5. 保证 bundle 清理只影响 `dist/server`。

验收：在 `apps/server` 内运行 `pnpm test && pnpm build` 成功；从根目录运行 `node dist/server/index.js` 后 `/health` 返回 200。

## 任务 6：更新说明与统一命令

1. 根脚本提供 extension、server、contracts 的 `dev`、`build`、`test`、`check` 和 server `start` 编排入口。
2. 更新根 README 的目录结构、Node 24 要求、安装、开发、构建与启动命令。
3. 更新 server README 中的路径和命令。
4. 保留插件离线降级行为说明。

验收：新用户只阅读根 README 即可完成安装、启动服务端、构建插件和找到 Chrome 加载目录。

## 任务 7：全量验证和目录迁移提交

1. 从 `packages/contracts` 运行类型检查。
2. 从 `apps/server` 运行测试与构建。
3. 从 `apps/extension` 运行测试与构建。
4. 从根目录运行 `pnpm check`。
5. 启动构建后的服务端并请求 `/health`。
6. 检查 `git diff --check`、敏感信息和意外生成文件。
7. 提交目录迁移，提交信息为 `refactor: organize apps as pnpm monorepo`；README 若含用户原有未提交内容则继续保留，不擅自纳入提交。

最终验收：满足设计文档中的全部验收标准，现有功能测试无回归，构建结果分别位于 `dist/extension` 与 `dist/server`。
