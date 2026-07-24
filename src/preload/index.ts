import { contextBridge, ipcRenderer } from 'electron'
import type { AgentBridge, AgentEvent, ModelConfig } from '../shared/contracts'
import { IPC } from '../shared/contracts'

const bridge: AgentBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (config: ModelConfig) => ipcRenderer.invoke(IPC.saveSettings, config),
  selectWorkspace: () => ipcRenderer.invoke(IPC.selectWorkspace),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  createSession: () => ipcRenderer.invoke(IPC.createSession),
  openSession: (sessionId) => ipcRenderer.invoke(IPC.openSession, sessionId),
  sendPrompt: (sessionId, text) => ipcRenderer.invoke(IPC.sendPrompt, sessionId, text),
  decideApproval: (requestId, decision) => ipcRenderer.invoke(IPC.decideApproval, requestId, decision),
  cancelRun: (sessionId) => ipcRenderer.invoke(IPC.cancelRun, sessionId),
  onAgentEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload)
    ipcRenderer.on(IPC.agentEvent, handler)
    return () => ipcRenderer.removeListener(IPC.agentEvent, handler)
  }
}

contextBridge.exposeInMainWorld('agent', bridge)
