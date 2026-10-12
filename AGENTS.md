# Fast Social 开发约定

本文件约束本仓库内的 Codex 开发工作。先读 [开发 Wiki](docs/wiki/README.md)，再阅读与任务相关的规范。用户当前明确要求优先；改变已有约定时同步更新文档，不能静默绕过。

## 开始工作

- 先查看 `git status`，保留用户及其他任务的未提交修改。
- 查明当前入口和真实调用链；`docs/superpowers/` 是历史方案，不能替代当前代码与 Wiki。
- 只完成当前任务需要的修改。用户已经明确授权的实现和常规验证直接继续，不反复要求确认。

## 必须遵守

1. **界面统一**：[交互规范](docs/wiki/ui-and-interactions.md)。操作按钮使用 `ActionButton`，只显示图标，`label` 同时提供悬停提示和无障碍名称。开关使用 `ToggleSwitch`，多选使用 checkbox。导航、选择项和 Skill 快捷卡片保留必要文字并标注 `data-ui`，不要用这些例外伪装普通操作按钮。
2. **请求前确认**：手动 AI 操作、内容抓取、Profile / 关系查询、画像更新和包含这些步骤的任务，调用统一 `confirmOperation`，确认通过后才能发送请求。键盘、快捷方式、重试必须经过同一入口。取消不能消费请求额度、改变任务状态或清空草稿；不能让一次确认授权多个点击。
3. **配置和身份边界**：[架构与数据](docs/wiki/architecture.md)。浏览器基础能力可离线使用；后端管理账号、凭证、关联和任务。列表筛选只是显示条件，执行账号从当前记录确定。稳定 actor ID 隔离请求额度、关注关系；聊天记录按账号隔离。
4. **AI 与 X 行为**：Skill 正文保存为完整文件，数据库保存元信息。监听 AI 判断按批提交；失败、截断、无效结果不推进进度。不确定的关注／回复结果不得自动重发。关注后回复仅允许本次新关注成功的目标；已关注或关注列表中已取消关注的目标跳过后续动作，按执行账号隔离。外部读取和写入均经过账号限额；仅监听、连续批量操作及自动画像任务中的 X 请求共用队列，前一次任务请求结束后至少间隔 30 秒；手动单次操作直接发送，仍检查每日额度并在超额时明确报错。手动执行整轮监听仍按任务限流；AI／本地处理不排队，动作层不叠加休眠。监听不按时间或最高 Post ID 过滤，只按已处理 ID 去重；指定用户首次也执行判断，帖子与回复合计每轮最多 5 次分页，达到上限正常结束，未获取的帖子不能标为已处理。
5. **数据保护**：尽量保留已有配置，但不为旧结构增加无必要的兼容层。改表前备份并验证保留的数据。用户明确要求本地请求追踪日志保留完整 curl 和凭证用于手动排错，遵循 [日志约定](docs/wiki/development.md#请求链路日志)；真实凭证不得复制进截图、测试夹具、文档或提交。生成文件写 `dist`，不要手工改产物代替源码。
6. **验证**：[开发与验证](docs/wiki/development.md)。功能先使用模拟账号、模拟 AI / X 验证；不得为测试操作真实关注、取消关注、回复或发送通知。只有用户明确要求该实际操作时才执行。复用现有工具链，不为简单改动引入新框架。
7. **文档维护**：行为、接口、存储、组件规范或流程有变化，同步修改对应 Wiki 页。通用约束写本文件，细节和例子写 Wiki，避免复制多份相互矛盾的规范。

## 交付前

- 执行 `pnpm lint:ui`、相关测试和相关构建；跨模块改动执行 `pnpm check`。
- UI 改动在模拟页面检查布局、悬停／键盘可用性、取消和确认路径；不要只依赖类型检查。
- 检查请求先后顺序、重复点击、账号切换、服务离线、异常后的状态恢复。
- Docker 使用镜像内代码，更新需重建镜像；重启前检查运行任务，完成后验证 `/health` 和实际导出的产物。
- 最终说明改动、验证结果，以及用户需要刷新页面还是重新加载插件；未验证的部分如实说明。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
