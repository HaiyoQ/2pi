import { contextBridge, ipcRenderer } from 'electron'
import type { AgentBridge, AgentEvent } from '../shared/contracts'
import { IPC } from '../shared/contracts'

const bridge: AgentBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  listProviderCatalog: () => ipcRenderer.invoke(IPC.listProviderCatalog),
  saveProvider: (draft) => ipcRenderer.invoke(IPC.saveProvider, draft),
  deleteProvider: (providerId) => ipcRenderer.invoke(IPC.deleteProvider, providerId),
  testProvider: (draft) => ipcRenderer.invoke(IPC.testProvider, draft),
  activateModel: (model) => ipcRenderer.invoke(IPC.activateModel, model),
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
