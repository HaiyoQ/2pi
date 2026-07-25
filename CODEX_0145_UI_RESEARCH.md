# Codex Desktop 0.145.0 一手资料核验（2026-07-25）

## 结论摘要

- **未公开/无法由 OpenAI Codex GitHub 仓库确认 Desktop 0.145.0 发布物。** 官方仓库公开标签命名为 `rust-v…`（例如 `rust-v0.146.0-alpha.6` 的 GitHub Release），没有名为 `0.145.0` 或 `desktop-v0.145.0` 的 release/tag。查询 GitHub Releases API（分页 1–5，2026-07-25）未返回任何 `0.145` 条目。来源：[releases API](https://api.github.com/repos/openai/codex/releases)，[tags API](https://api.github.com/repos/openai/codex/tags?per_page=100)，[GitHub releases 页面](https://github.com/openai/codex/releases)。
- **官方仓库不是桌面前端源码仓库。** README 将项目标题定义为 “Codex CLI” (`README.md:1`)，并称桌面体验通过运行 `codex app` 或访问 ChatGPT Codex App 页面 (`README.md:6-8`)，安装器从 `releases.openai.com/codex` 下载、GitHub Releases 仅作回退 (`README.md:28-32`)。仓库顶层可见 `codex-rs/tui`、`sdk`、`docs` 等 CLI/运行时目录，没有 Desktop/Electron/Swift 前端目录（以 main 分支浅克隆目录清单核验）。因此 Desktop 0.145.0 的窗口 UI 源码/打包物在该仓库**未公开**。
- 仓库 README 仅提供一张 **Codex CLI splash** 图片（`.github/codex-cli-splash.png`，`README.md:3`），不是 Desktop 0.145.0 UI 截图；未找到官方仓库内针对 sidebar、composer、tool-call chain、diff、thread history、settings 或 desktop icons 的截图/视频资产。

## 可核验的官方事实

### 版本、发布时间与发布物

1. GitHub Releases API 的最新公开条目示例为 `rust-v0.146.0-alpha.6`，字段 `published_at: 2026-07-24T05:31:18Z`，页面为 <https://github.com/openai/codex/releases/tag/rust-v0.146.0-alpha.6>；其 `assets` 是 CLI 构建/工具资产，而非桌面安装器。API 原文入口：<https://api.github.com/repos/openai/codex/releases>。**确认：**该 API 可证实仓库公开 release 的命名和发布时间；**未公开：**没有 0.145.0 Desktop 条目。
2. 仓库标签列表包含历史 Rust alpha 标签（可直接查阅 <https://api.github.com/repos/openai/codex/tags?per_page=100>；Git refs 亦可查 <https://github.com/openai/codex/tags>），但未发现 Desktop 0.145.0 标签。**确认（基于当前公开 API 快照）：**无匹配标签；**不排除：**桌面版本可能通过 ChatGPT/内部发行渠道发布。
3. README 明确写出默认下载源 `https://releases.openai.com/codex`，并可通过 `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false` 强制 GitHub Releases (`README.md:28-32`)。**确认：**这是 CLI 安装器发布渠道说明；**推断：**不能据此推导 Desktop 0.145.0 的具体安装包或发布时间。

### 桌面入口与源码范围

- <https://github.com/openai/codex/blob/main/README.md> 第 1 行：“**Codex CLI** is a coding agent …”；第 7 行：“If you want the desktop app experience, run `codex app` or visit … Codex App page”；第 8 行区分 Codex Web。**确认：**桌面体验被作为 CLI 的 `codex app` 入口/外部页面描述，README 没有桌面源码链接。
- 官方开发者文档入口 <https://developers.openai.com/codex>、IDE 文档 <https://developers.openai.com/codex/ide> 说明 CLI/IDE 集成；未在公开页面发现 0.145.0 Desktop changelog、截图或视频。**未公开：**窗口布局和具体交互规格。

## UI 证据矩阵（仅一手来源）

| 目标 UI 元素 | 官方 0.145.0 证据 | 状态 |
|---|---|---|
| 窗口整体布局 | 仓库仅有 CLI splash；无 Desktop 0.145.0 截图/视频 | 未公开 |
| Sidebar | 未找到官方 Desktop 资源或源码 | 未公开 |
| Composer（输入区） | README/公开 docs 无 Desktop 说明 | 未公开 |
| Tool-call chain | 仓库有 CLI/TUI 代码，但不能证明 Desktop UI 形态 | 推断（仅运行时能力） |
| Diff 展示 | README 无 Desktop 截图；CLI 源码存在 diff 相关能力不能代表桌面布局 | 推断 |
| Thread history | README 提及 Codex Web/App 入口，不给 Desktop 组件细节 | 未公开 |
| Settings | 未找到 Desktop 0.145.0 官方页面/资产 | 未公开 |
| Icons | 仅见仓库通用图片 `codex-cli-splash.png`，非 Desktop 图标集 | 确认（资产用途）；Desktop 图标未公开 |

## 限制

以上结论基于截至 2026-07-25 可访问的 OpenAI 官方域名与 `github.com/openai/codex` 公开 API/仓库。ChatGPT Codex App 可能需要登录，无法作为可公开核验的版本/截图证据；因此没有把其 UI 传闻或二手报道写入结论。
