import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../shared/contracts'
import type { AgentRuntime } from './runtime/agent-runtime'
import { parseActiveModel, parseAgentPreferences, parsePromptInput, parseProviderConnectionDraft, parseProviderDraft, requireNonEmpty } from './runtime/validation'

export function registerIpc(window: BrowserWindow, runtime: AgentRuntime): void {
  ipcMain.handle(IPC.getSettings, () => runtime.getSettings())
  ipcMain.handle(IPC.listProviderCatalog, () => runtime.listProviderCatalog())
  ipcMain.handle(IPC.saveProvider, (_event, value: unknown) => runtime.saveProvider(parseProviderDraft(value)))
  ipcMain.handle(IPC.deleteProvider, (_event, value: unknown) => runtime.deleteProvider(requireNonEmpty(value, '供应商 ID', 200)))
  ipcMain.handle(IPC.testProvider, (_event, value: unknown) => runtime.testProvider(parseProviderConnectionDraft(value)))
  ipcMain.handle(IPC.activateModel, (_event, value: unknown) => runtime.activateModel(parseActiveModel(value)))
  ipcMain.handle(IPC.saveAgentPreferences, (_event, value: unknown) => runtime.saveAgentPreferences(parseAgentPreferences(value)))
  ipcMain.handle(IPC.selectWorkspace, async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择工作目录', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    return runtime.saveWorkspace(result.filePaths[0])
  })
  ipcMain.handle(IPC.listModels, () => runtime.listModels())
  ipcMain.handle(IPC.listSessions, () => runtime.listSessions())
  ipcMain.handle(IPC.searchSessions, (_event, value: unknown) => {
    if (typeof value !== 'string' || value.length > 500) throw new Error('历史搜索内容无效')
    return runtime.searchSessions(value)
  })
  ipcMain.handle(IPC.createSession, () => runtime.createSession())
  ipcMain.handle(IPC.openSession, (_event, value: unknown) => runtime.openSession(requireNonEmpty(value, '会话 ID', 200)))
  ipcMain.handle(IPC.renameSession, (_event, sessionId: unknown, name: unknown) => runtime.renameSession(
    requireNonEmpty(sessionId, '会话 ID', 200), requireNonEmpty(name, '会话名称', 120)))
  ipcMain.handle(IPC.getSessionTree, (_event, sessionId: unknown) =>
    runtime.getSessionTree(requireNonEmpty(sessionId, '会话 ID', 200)))
  ipcMain.handle(IPC.branchSession, (_event, sessionId: unknown, requestId: unknown, entryId: unknown) =>
    runtime.branchSession(
      requireNonEmpty(sessionId, '会话 ID', 200),
      requireNonEmpty(requestId, '分支请求 ID', 200),
      requireNonEmpty(entryId, '历史节点 ID', 200)
    ))
  ipcMain.handle(IPC.getGitDiff, () => runtime.getGitDiff())
  ipcMain.handle(IPC.sendPrompt, (_event, sessionId: unknown, input: unknown) =>
    runtime.sendPrompt(requireNonEmpty(sessionId, '会话 ID', 200), parsePromptInput(input)))
  ipcMain.handle(IPC.queuePrompt, (_event, sessionId: unknown, requestId: unknown, input: unknown, mode: unknown) => {
    if (mode !== 'steer' && mode !== 'follow-up') throw new Error('追加消息类型无效')
    return runtime.queuePrompt(
      requireNonEmpty(sessionId, '会话 ID', 200),
      requireNonEmpty(requestId, '消息 ID', 200),
      parsePromptInput(input),
      mode
    )
  })
  ipcMain.handle(IPC.removeQueuedPrompt, (_event, sessionId: unknown, messageId: unknown) =>
    runtime.removeQueuedPrompt(requireNonEmpty(sessionId, '会话 ID', 200), requireNonEmpty(messageId, '消息 ID', 200)))
  ipcMain.handle(IPC.compactSession, (_event, sessionId: unknown) =>
    runtime.compactSession(requireNonEmpty(sessionId, '会话 ID', 200)))
  ipcMain.handle(IPC.listAgentResources, () => runtime.listAgentResources())
  ipcMain.handle(IPC.reloadAgentResources, () => runtime.reloadAgentResources())
  ipcMain.handle(IPC.setProjectResourceTrust, (_event, trusted: unknown) => {
    if (typeof trusted !== 'boolean') throw new Error('项目资源信任设置无效')
    return runtime.setProjectResourceTrust(trusted)
  })
  ipcMain.handle(IPC.cancelRun, (_event, sessionId: unknown) => runtime.cancel(requireNonEmpty(sessionId, '会话 ID', 200)))

  runtime.subscribe((event) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.agentEvent, event)
  })
}
