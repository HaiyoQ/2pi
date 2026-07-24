# 功能说明与设计记录

## Windows 本地编程 Agent MVP

**状态**：开发中（2026-07-24 18:00 CST）

**需求背景**：面向 Windows 本地项目提供一个可直接使用的编程助手。用户需要在桌面应用内选择项目、配置模型、发送任务，并在 Agent 修改文件或执行命令前明确确认，不依赖独立后端、数据库、账号系统或沙箱。

**设计思路**：应用采用 Electron、Vue 3、Vite、Pinia 和 Element Plus。renderer 只负责界面与状态展示，preload 暴露固定的类型化 IPC，主进程中的 `AgentRuntime` 独占 Agent SDK、文件系统和模型密钥。`@earendil-works/pi-ai`、`pi-agent-core` 与 `pi-coding-agent` 固定为 `0.81.1`。工具审批作为 coding-agent 的内联扩展接入，通过 `tool_call` 钩子阻止未获批准的写入和命令执行，Agent 核心不包含桌面 UI 逻辑。

**关键决策**：读取、搜索和目录查看可直接执行；`bash`、`edit`、`write` 必须审批。审批使用唯一 request ID，首次决定后固定结果，重复点击不会重复执行。Windows 终端工具使用自定义 PowerShell 执行适配器，并以 UTF-8 输出；不要求用户额外安装 Git Bash。API Key 只通过 IPC 进入主进程，使用 Electron `safeStorage` 加密后保存，不写入 renderer 日志或会话。

**核心流程**：用户先选择工作目录，并在供应商配置中心添加服务商、配置密钥与模型；随后选定当前模型，新建或恢复会话并发送任务。Agent 输出以事件流显示。遇到命令或文件修改时，主进程发出脱敏的审批摘要并暂停该工具；批准后继续执行，拒绝后向 Agent 返回被阻止结果。用户可随时中止运行，待审批请求也会同步取消。

**涉及模块/文件**：`src/renderer` 包含聊天、会话、审批和设置界面；`src/preload/index.ts` 是唯一 renderer 到主进程桥梁；`src/shared/contracts.ts` 定义稳定的 IPC 与事件类型；`src/main/ipc.ts` 校验 IPC 参数；`src/main/runtime/agent-runtime.ts` 管理 SDK 会话、模型、工具、事件和取消；`approval-gate.ts` 管理幂等审批；`settings-store.ts` 管理设置与密钥；`tests` 覆盖事件转换、参数校验、审批幂等、设置和会话恢复。

**配置项**：设置文件位于 Electron `app.getPath("userData")/settings.json`，包含 v2 供应商档案、当前模型、工作目录及加密后的密钥数据，应用卸载或用户清除应用数据前持续存在。SDK 会话以 JSONL 保存在 `app.getPath("userData")/sessions`，生命周期由用户数据目录管理；项目文件始终只位于用户选择的工作目录。SDK 内部配置位于 `app.getPath("userData")/agent`。当前没有环境变量、远端配置、数据库或特性开关。

**变更记录**：2026-07-24 18:00 CST，创建 Windows MVP 工程、类型化 IPC、AgentRuntime、扩展式工具审批、会话与设置持久化、中文桌面界面及基础测试。2026-07-24 20:38 CST，显式关闭 Electron 默认 renderer sandbox，修复 ESM preload 未执行、`window.agent` 无法注入的问题，并增加窗口配置回归测试。

## 多供应商与自定义模型设置

**状态**：已完成（2026-07-24 21:09 CST）

**需求背景**：原有设置只能保存一个服务商、一个模型和一份 API Key，无法同时管理 OpenAI、Anthropic、本地模型和企业网关。用户也无法在不修改代码的情况下接入 OpenAI 兼容服务或带额外请求头的内部接口。

**设计思路**：模型设置升级为供应商配置中心。日常列表只展示用户已经添加的供应商；SDK 内置目录在“添加供应商”流程中按需读取。每个供应商拥有独立名称、协议、Base URL、模型列表、API Key 和请求头。自定义供应商通过 `ModelRuntime.registerProvider()` 注册到 Agent 运行时，支持 OpenAI Chat、OpenAI Responses、Anthropic Messages 和 Google Generative AI 四种协议，并为手动模型补充文本输入、128K 上下文、16K 最大输出和零成本等 SDK 必需元数据。

**关键决策**：设置文件使用版本 2，并自动迁移旧版 `provider/modelId/encryptedApiKey`，保留原 OpenAI 选择与密钥；新安装不预置供应商。API Key 与整组请求头值分别使用 Electron `safeStorage` 加密，renderer 和 IPC 返回值只包含 `hasApiKey`、请求头名称及是否已保存，不返回秘密值。自定义供应商使用 `custom-<uuid>` 稳定 ID；内置供应商沿用 SDK ID。运行期间拒绝编辑、删除或切换模型，避免流式请求中途改变配置。空闲会话切换模型使用 SDK `session.setModel()`，不重建或删除会话历史。

**核心流程**：用户从应用侧栏进入“设置”，在左侧设置导航中打开“模型设置”。供应商通过内容区顶部的选择入口展开，下拉面板使用一个搜索框同时检索已添加供应商和可添加的内置供应商，下方固定高度列表独立滚动；自定义供应商也从同一面板进入。首次使用或删除最后一个供应商后，下拉框下方默认直接展示自定义供应商表单，用户无需额外点击即可填写。填写协议、地址、密钥、可选请求头和模型后，可执行 15 秒超时的连接测试：OpenAI 兼容接口读取 `/models`，Anthropic 读取 `/v1/models`，Google 读取 `/models`，测试结果可加入模型列表；接口不支持发现或测试失败时仍可手动填写并保存。保存后供应商立即注册到运行时，用户再从该供应商的模型列表中明确激活当前模型。删除正在使用的唯一供应商时会清空当前模型并释放内存中的运行时会话，但不会删除磁盘上的 JSONL 会话记录。

**涉及模块/文件**：`src/renderer/src/App.vue` 和 `styles.css` 提供双栏配置中心、目录搜索、连接测试、模型与请求头编辑、空状态和运行锁定提示；`stores/agent.ts` 管理供应商目录与激活模型状态；`src/shared/contracts.ts` 定义供应商档案、草稿、协议、连接结果和 IPC；`src/preload/index.ts` 暴露固定桥接；`src/main/ipc.ts` 在主进程入口校验输入；`settings-store.ts` 负责 v2 迁移、加密存储和幂等更新；`provider-discovery.ts` 负责模型发现与错误转换；`agent-runtime.ts` 负责 SDK 目录、注册、密钥注入、模型切换和会话释放。

**配置项**：所有公开配置继续保存在 `app.getPath("userData")/settings.json`。供应商 API Key 保存为独立的加密字段；请求头名称以明文保存用于界面展示，所有请求头值序列化后整体加密。解密仅发生在 Electron 主进程，秘密值只进入连接测试请求和 `ModelRuntime` 内存，不写入 SDK `models.json`、会话 JSONL、renderer 状态或错误信息。连接测试超时为 15 秒，目前没有环境变量或特性开关。

**变更记录**：2026-07-24 21:09 CST，完成设置 v2、旧配置迁移、多供应商加密存储、SDK 内置目录、自定义供应商注册、四协议连接测试与模型发现、会话内模型切换、双栏中文设置界面及相关单元/本地 HTTP 集成测试。2026-07-24 21:24 CST，将侧栏入口统一为“设置”，设置中心左侧改为可扩展页面导航，并将供应商日常列表收纳为带搜索和固定滚动区的下拉选择器。2026-07-24 21:38 CST，重构供应商选择和添加流程为统一下拉面板，并让自定义供应商表单在首次使用时默认展示。
