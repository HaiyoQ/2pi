# 功能说明与设计记录

## Windows 本地编程 Agent MVP

**状态**：开发中（2026-07-24 18:00 CST）

**需求背景**：面向 Windows 本地项目提供一个可直接使用的编程助手。用户需要在桌面应用内选择项目、配置模型、发送任务，并在 Agent 修改文件或执行命令前明确确认，不依赖独立后端、数据库、账号系统或沙箱。

**设计思路**：应用采用 Electron、Vue 3、Vite、Pinia 和 Element Plus。renderer 只负责界面与状态展示，preload 暴露固定的类型化 IPC，主进程中的 `AgentRuntime` 独占 Agent SDK、文件系统和模型密钥。`@earendil-works/pi-ai`、`pi-agent-core` 与 `pi-coding-agent` 固定为 `0.81.1`。工具审批作为 coding-agent 的内联扩展接入，通过 `tool_call` 钩子阻止未获批准的写入和命令执行，Agent 核心不包含桌面 UI 逻辑。

**关键决策**：读取、搜索和目录查看可直接执行；`bash`、`edit`、`write` 必须审批。审批使用唯一 request ID，首次决定后固定结果，重复点击不会重复执行。Windows 终端工具使用自定义 PowerShell 执行适配器，并以 UTF-8 输出；不要求用户额外安装 Git Bash。API Key 只通过 IPC 进入主进程，使用 Electron `safeStorage` 加密后保存，不写入 renderer 日志或会话。

**核心流程**：用户先选择工作目录并在模型设置中选择服务商、模型及 API Key；随后新建或恢复会话并发送任务。Agent 输出以事件流显示。遇到命令或文件修改时，主进程发出脱敏的审批摘要并暂停该工具；批准后继续执行，拒绝后向 Agent 返回被阻止结果。用户可随时中止运行，待审批请求也会同步取消。

**涉及模块/文件**：`src/renderer` 包含聊天、会话、审批和设置界面；`src/preload/index.ts` 是唯一 renderer 到主进程桥梁；`src/shared/contracts.ts` 定义稳定的 IPC 与事件类型；`src/main/ipc.ts` 校验 IPC 参数；`src/main/runtime/agent-runtime.ts` 管理 SDK 会话、模型、工具、事件和取消；`approval-gate.ts` 管理幂等审批；`settings-store.ts` 管理设置与密钥；`tests` 覆盖事件转换、参数校验、审批幂等、设置和会话恢复。

**配置项**：设置文件位于 Electron `app.getPath("userData")/settings.json`，包含模型标识、工作目录及加密后的 API Key，应用卸载或用户清除应用数据前持续存在。SDK 会话以 JSONL 保存在 `app.getPath("userData")/sessions`，生命周期由用户数据目录管理；项目文件始终只位于用户选择的工作目录。SDK 内部配置位于 `app.getPath("userData")/agent`。当前没有环境变量、远端配置、数据库或特性开关。

**变更记录**：2026-07-24 18:00 CST，创建 Windows MVP 工程、类型化 IPC、AgentRuntime、扩展式工具审批、会话与设置持久化、中文桌面界面及基础测试。2026-07-24 20:38 CST，显式关闭 Electron 默认 renderer sandbox，修复 ESM preload 未执行、`window.agent` 无法注入的问题，并增加窗口配置回归测试。
