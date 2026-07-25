# Codex 桌面端相关一手资料研究

研究日期：2026-07-25。来源仅限 OpenAI 官方仓库 `openai/codex`、仓库文档及 OpenAI 官方 Codex 链接。源码行号对应浅克隆时的 `main` 快照；链接使用 GitHub 永久可访问路径（行号用于定位，提交更新后应重新核对）。

## 先划清证据边界

- **桌面 App 可观察事实**：官方 README 仅写明“桌面 app experience”通过 `codex app` 或 Codex App 页面进入（[README.md#L1-L8](https://github.com/openai/codex/blob/main/README.md#L1-L8)）。该开源仓库没有 Electron/Swift/React 桌面壳、首屏截图或桌面布局实现可供核验。
- **开源 app-server/TUI 协议事实**：`codex-rs/app-server-protocol` 明确定义线程、回合、模型、审批和流式事件；`codex-rs/tui` 是终端 UI。它们可作为桌面客户端的协议/交互借鉴，但不能声称它们就是桌面 UI。
- **原型借鉴**：下文把协议事件映射为建议的桌面信息架构，属于基于共同需求的设计推断，不是官方桌面源码事实。

## 关键发现

1. **项目/会话导航的协议基础**。线程生命周期有 `thread/start`、`thread/resume`、`thread/fork` 等请求（[common.rs#L488-L507](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L488-L507)）；会话列表通过 `thread/list`（[common.rs#L630-L640](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L630-L640)）。原型可将工作区/项目作为左侧范围，把可恢复线程列在其下，但“桌面左栏长什么样”没有官方开源证据。
2. **主任务区的运行单元是 thread -> turn -> item**。发送请求用 `turn/start`，同一线程可 `turn/steer`，停止用 `turn/interrupt`（[common.rs#L831-L846](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L831-L846)）。因此桌面主区应围绕当前 thread 的 turn 时间线组织，而不是仅显示一次性聊天消息（原型借鉴）。
3. **首次登录/目录选择不能从开源桌面 UI 推断**。源码树未提供桌面首启流程；只能确认线程启动参数/恢复参数属于 app-server v2 协议，认证与本地凭据也由 CLI/app-server 组件处理。不要把 TUI 的启动提示当成桌面首屏。
4. **输入区至少需要显示模型与执行策略的当前值**。协议有 `model/list` 和 `modelProvider/capabilities/read`（[common.rs#L890-L898](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L890-L898)），并有 `permissionProfile/list`（[common.rs#L905-L907](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L905-L907)）。`turn/start` 是提交边界；原型可在输入框工具栏展示模型、推理强度、权限/沙箱模式，但具体桌面控件样式没有来源。
5. **审批是运行过程中的可交互暂停点**。服务端可请求命令执行审批、文件变更审批，以及额外权限审批（[common.rs#L1496-L1528](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1496-L1528)）。桌面实现应把审批卡片放在当前任务流内，明确命令/文件和允许范围；不要只做全局设置开关（原型借鉴）。
6. **运行过程有明确的生命周期事件**：`turn/started`、`turn/completed`、`item/started`、`item/completed`、`turn/plan/updated`（[common.rs#L1671-L1679](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1671-L1679)）。这支持桌面任务区显示进行中、完成、计划更新和逐项状态。
7. **Agent 文本、计划、命令输出、文件修改均可流式更新**：`item/agentMessage/delta`、`item/plan/delta`、`item/commandExecution/outputDelta`、`item/fileChange/patchUpdated` 等（[common.rs#L1685-L1700](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1685-L1700)）。长命令输出应默认折叠、按需展开是合理原型行为，但“官方桌面折叠规则”不存在。
8. **思考展示应限于摘要而非原始思维链**。协议同时列出 `item/reasoning/summaryTextDelta`、`summaryPartAdded` 与 `reasoning/textDelta`（[common.rs#L1712-L1714](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1712-L1714)）；TUI 测试明确断言 raw reasoning 不应渲染（`codex-rs/tui/src/app/agent_status_feed_tests.rs#L68-L112`，[源码链接](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app/agent_status_feed_tests.rs#L68-L112)）。桌面应展示可审阅的 reasoning summary，不展示隐藏原文。
9. **模型可能在运行中重路由/验证/安全缓冲**。协议有 `model/rerouted`、`model/verification`、`model/safetyBuffering/updated`（[common.rs#L1717-L1721](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1717-L1721)）。任务区需要能显示“模型发生变化/等待安全缓冲”等非最终文本状态（原型借鉴）。
10. **失败、重试和最终结果应由状态与通知驱动**。`turn/completed` 与 `item/completed` 是终止边界，另有 `warning`、`configWarning`、`deprecationNotice`（[common.rs#L1671-L1679](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1671-L1679)、[common.rs#L1721-L1725](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1721-L1725)）。协议没有一个名为“重试按钮”的桌面组件；客户端可根据失败 turn 提供重试入口，这是产品层推断。
11. **设置/工具控制不是单一设置页的官方布局**。协议层暴露模型提供商能力、权限配置、插件/动态工具相关请求（例如动态工具调用 [common.rs#L1530-L1534](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L1530-L1534)），但没有桌面 settings UI 源码。原型可分为全局设置、项目设置、当前线程覆盖三层，需在本项目中自行定义持久化边界。
12. **目录与项目边界必须由客户端补足**。协议序列化会以 `thread_id` 或路径关联线程（例如 resume/fork [common.rs#L497-L507](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs#L497-L507)），但不存在“选择目录弹窗”的跨平台 UI 实现。任何目录选择、最近项目列表、文件树都只能作为本项目桌面壳的产品设计。

## 对本项目原型的可用映射（明确属于借鉴）

建议桌面壳采用：左侧“项目/工作区 + 线程列表”；中间“当前 thread 的 turn/item 时间线”；底部输入区显示模型、推理级别和权限模式，并以发送/停止互斥状态绑定 `turn/start` 与 `turn/interrupt`；运行卡片按 item 类型分别呈现计划、摘要、命令、输出、文件 diff、审批和错误；长输出默认摘要化并可展开。上述映射来自协议事件，不代表官方桌面布局。

## 未覆盖与不可声称

本次官方开源树未找到桌面客户端的壳层代码、首次登录页面、目录选择器、桌面设置页、桌面视觉规范或截图级交互实现。因此不能据此断言官方桌面端采用某种导航栏、卡片、按钮文案、折叠阈值或颜色；只能引用 README 的入口声明及 app-server/TUI 的协议事实。

## 官方手册补充的桌面可观察事实

- Codex 在桌面端保留独立视图和面向开发工作的独立历史；Projects 视图同时包含普通项目和连接本地文件夹的本地项目。来源：[Projects and chats](https://learn.chatgpt.com/docs/projects)、[What's new](https://learn.chatgpt.com/docs/whats-new)。
- 项目和聊天支持固定、重命名、搜索与归档；固定只改变侧栏位置，不改变 Agent 可访问的上下文。来源：[Projects and chats](https://learn.chatgpt.com/docs/projects)。
- 桌面端权限控件位于输入区下方。2π 原型借鉴“运行合同紧邻输入区”，仍使用自身已确认的“只读/全自动”两档。来源：[Permissions](https://learn.chatgpt.com/docs/permission-modes)。
- Codex 工作期间可把新消息用于 steer 当前回合，或 queue 到下一回合；排队消息显示在输入区上方，并可编辑、排序、发送或删除。来源：[Prompting: Steering and queuing](https://learn.chatgpt.com/docs/prompting#steering-and-queuing)。
- 桌面端可切换 Diff 面板审阅本地改动，并针对具体改动行反馈。来源：[Best practices: Improve reliability with testing and review](https://learn.chatgpt.com/docs/best-practices#improve-reliability-with-testing-and-review)。
- 桌面端会暴露子代理线程供检查。原型把它压缩成输入区上方的可展开运行条，但具体位置属于 2π 的设计推断。来源：[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。
- 全局配置在桌面设置中提供“Open config.toml”入口，CLI、IDE 与桌面端共享配置层。2π 只借鉴“正式设置页 + 明确全局边界”。来源：[Best practices: Configure Codex for consistency](https://learn.chatgpt.com/docs/best-practices#configure-codex-for-consistency)。
- 桌面端本地工作支持 ChatGPT 登录和 API Key 两种方式；开源仓库仍未提供可核验的登录页视觉实现。来源：[Authentication](https://learn.chatgpt.com/docs/auth)。
