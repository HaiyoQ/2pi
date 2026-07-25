# Codex `rust-v0.145.0` 官方来源研究

研究日期：2026-07-25。目标版本：[`rust-v0.145.0`](https://github.com/openai/codex/releases/tag/rust-v0.145.0)，发布于 2026-07-21（GitHub Release API 的 `published_at`）。以下只把能由该 tag/release 或 OpenAI 官方页面直接核验的内容记为事实；没有把当前 Desktop 客户端的推测布局倒灌为 0.145.0 事实。

## 版本边界

- Release API：<https://api.github.com/repos/openai/codex/releases/tags/rust-v0.145.0>。原文 `"tag_name": "rust-v0.145.0"`、`"name": "0.145.0"`、`"published_at": "2026-07-21T18:21:04Z"`。
- Release 正文明确是 Rust Codex 的功能/修复清单，并链接 `Full Changelog: https://github.com/openai/codex/compare/rust-v0.144.0...rust-v0.145.0`。
- Release 正文没有 Desktop UI 截图、组件规格、工具图标名称、窗口布局或 CSS/前端工程说明。因此这些细节对 0.145.0 **不可由 release 直接证明**。

## 0.145.0 明确可证事实

### 历史/记录

Release 正文原文：`Added experimental paginated thread history with efficient resume, search, persisted names, sub-agent support, and memories.` 这是该版本明确新增的线程历史能力；同一正文还列出 `Editing an earlier prompt or retrying a safety-buffered turn now creates a contextual branch, preserving the original conversation, attachments, and mention bindings.`

源码（tag 对应 Rust TUI；可从 GitHub 网页的 tag 文件查看）：

- [`codex-rs/tui/src/app/history_ui.rs`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/app/history_ui.rs) 模块注释原文：`Terminal history, desktop handoff, and clear-screen UI helpers for the TUI app.` `insert_history_cell` 同时写入 transcript 与 `Overlay::Transcript`，并按终端宽度包装历史行（约第 11-31 行）。
- [`codex-rs/tui/src/app/event_dispatch.rs`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/app/event_dispatch.rs) 处理 `BeginInitialHistoryReplayBuffer`、`BeginThreadSwitchHistoryReplayBuffer`、`InsertHistoryCell`、`EndInitialHistoryReplayBuffer`（约第 303-314 行），证明启动/切线程存在历史回放缓冲。
- Release Changelog 明列 `Persist paginated items in the local thread store`（#32289）、`Persist names for paginated threads`（#34229）、`Add occurrence search for paginated threads`（#33907）。这些是 0.145.0 changelog 项，不等于 Desktop UI 设计。

### Diff

- Release 正文原文：`Added ...` 清单之外，源码的 Slash command 描述给出 `/diff`：[`codex-rs/tui/src/slash_command.rs`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/slash_command.rs#L98-L102) 原文 `"show git diff (including untracked files)"`。
- 该证据证明 TUI 有可见的 Diff 命令语义；不能证明 Desktop 端采用何种 diff 面板、颜色、图标或布局。

### Composer 与设置入口

同一官方源码的用户可见命令描述：

- `/vim`：`toggle Vim mode for the composer`（[`slash_command.rs#L127-L131`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/slash_command.rs#L127-L131)）。这证明 TUI 存在 composer，并可切换 Vim 模式。
- `/model`：`choose what model and reasoning effort to use`；`/permissions`：`choose what Codex is allowed to do`；`/keymap`：`remap TUI shortcuts`；`/theme`：`choose a syntax highlighting theme`；`/experimental`：`toggle experimental features`（[`slash_command.rs#L116-L137`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/slash_command.rs#L116-L137)）。这些是 TUI 设置/命令能力，不是 Desktop 设置页面布局证据。

### Desktop handoff

[`codex-rs/tui/src/app/history_ui.rs#L8-L91`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/app/history_ui.rs#L8-L91) 定义 `DESKTOP_THREAD_OPENED_MESSAGE = "Opened this session in the Desktop app."`，`open_desktop_thread` 构造 `codex://threads/{thread_id}` 并调用 `open_desktop_thread_url`。Slash command 描述中 `/app` 是 `continue this session in the Desktop app`（[`slash_command.rs#L94-L100`](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/tui/src/slash_command.rs#L94-L100)）。

事实边界：这证明 0.145.0 TUI 到 Desktop 的会话 handoff 协议入口（`codex://threads/...`）和文案；没有证明 Desktop 客户端内部实现、窗口尺寸、侧栏、工具图标或组件树。

### 工具调用链与收放

Release 正文可证的工具相关内容包括：`Added audio inputs and tool outputs`、MCP 启动/认证流程改进、`Strengthened safety and approval handling ... preserved rejection reasons across tools`，以及 changelog 中 `Reduce MCP tool-list trace volume`、`Remove the redundant tool dispatch wrapper`、`Support ... deferred tools` 等。它们证明运行时工具/审批/输出链路有改动。

但在 0.145.0 官方 release 或 Rust TUI 源码中，没有找到 Desktop UI 级别“工具调用链展开/折叠”的命名组件或交互规范。不能把 TUI transcript/history cell 的渲染、或其他版本/截图中的折叠行为推断成 Desktop 0.145.0 行为。

### 工具图标与布局组件

未在 0.145.0 release body、tag 下 `codex-rs/tui` 源码或公开 GitHub 资产中找到 Desktop 专用图标清单、侧栏/顶栏/Composer 组件规格、布局断点或 CSS。可证的 UI 仅限终端 TUI 的 history cell、transcript overlay、命令 popup 描述和 Desktop handoff 文案。

## 当前/相近版本信息（不可冒充 0.145.0）

OpenAI 官方 Codex 仓库的 `main` 或后续 release 可能包含 Desktop app-server、客户端 UI 或新布局；除非其源码/发行物明确标注并可追溯到 `rust-v0.145.0`，否则只能作为“当前/相近版本”参考。本文件没有使用这些材料替代 0.145.0 证据。

## 结论

对用户要求的 Desktop 布局、组件、工具图标、工具调用链收放、记录/历史、Diff、composer、设置：0.145.0 官方材料能可靠确认的是 Rust TUI 的历史/回放、`/diff`、composer 的 Vim 模式、若干设置命令，以及通过 `codex://threads/{thread_id}` 打开 Desktop 的 handoff。Desktop 内部视觉布局和折叠/图标细节在该 tag 的官方公开证据中未被定义，实施时应标为产品设计推断，而非“复刻 0.145.0”。
