import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../shared/contracts'
import type { AgentRuntime } from './runtime/agent-runtime'
import type { SettingsStore } from './runtime/settings-store'
import { parseActiveModel, parseProviderDraft, requireNonEmpty } from './runtime/validation'

export function registerIpc(window: BrowserWindow, runtime: AgentRuntime, settings: SettingsStore): void {
  ipcMain.handle(IPC.getSettings, () => runtime.getSettings())
  ipcMain.handle(IPC.listProviderCatalog, () => runtime.listProviderCatalog())
  ipcMain.handle(IPC.saveProvider, (_event, value: unknown) => runtime.saveProvider(parseProviderDraft(value)))
  ipcMain.handle(IPC.deleteProvider, (_event, value: unknown) => runtime.deleteProvider(requireNonEmpty(value, '供应商 ID', 200)))
  ipcMain.handle(IPC.testProvider, (_event, value: unknown) => runtime.testProvider(parseProviderDraft(value)))
  ipcMain.handle(IPC.activateModel, (_event, value: unknown) => runtime.activateModel(parseActiveModel(value)))
  ipcMain.handle(IPC.selectWorkspace, async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择工作目录', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    await settings.saveWorkspace(result.filePaths[0])
    return { path: result.filePaths[0] }
  })
  ipcMain.handle(IPC.listModels, () => runtime.listModels())
  ipcMain.handle(IPC.listSessions, () => runtime.listSessions())
  ipcMain.handle(IPC.createSession, () => runtime.createSession())
  ipcMain.handle(IPC.openSession, (_event, value: unknown) => runtime.openSession(requireNonEmpty(value, '会话 ID', 200)))
  ipcMain.handle(IPC.sendPrompt, (_event, sessionId: unknown, text: unknown) =>
    runtime.sendPrompt(requireNonEmpty(sessionId, '会话 ID', 200), requireNonEmpty(text, '任务内容')))
  ipcMain.handle(IPC.decideApproval, (_event, requestId: unknown, decision: unknown) => {
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('审批决定无效')
    return runtime.decideApproval(requireNonEmpty(requestId, '审批 ID', 200), decision)
  })
  ipcMain.handle(IPC.cancelRun, (_event, sessionId: unknown) => runtime.cancel(requireNonEmpty(sessionId, '会话 ID', 200)))

  runtime.subscribe((event) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.agentEvent, event)
  })
}
