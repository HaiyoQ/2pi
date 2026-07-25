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
  saveAgentPreferences: (preferences) => ipcRenderer.invoke(IPC.saveAgentPreferences, preferences),
  selectWorkspace: () => ipcRenderer.invoke(IPC.selectWorkspace),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  searchSessions: (query) => ipcRenderer.invoke(IPC.searchSessions, query),
  createSession: () => ipcRenderer.invoke(IPC.createSession),
  openSession: (sessionId) => ipcRenderer.invoke(IPC.openSession, sessionId),
  renameSession: (sessionId, name) => ipcRenderer.invoke(IPC.renameSession, sessionId, name),
  getSessionTree: (sessionId) => ipcRenderer.invoke(IPC.getSessionTree, sessionId),
  branchSession: (sessionId, requestId, entryId) => ipcRenderer.invoke(IPC.branchSession, sessionId, requestId, entryId),
  getGitDiff: () => ipcRenderer.invoke(IPC.getGitDiff),
  sendPrompt: (sessionId, input) => ipcRenderer.invoke(IPC.sendPrompt, sessionId, input),
  queuePrompt: (sessionId, requestId, input, mode) => ipcRenderer.invoke(IPC.queuePrompt, sessionId, requestId, input, mode),
  removeQueuedPrompt: (sessionId, messageId) => ipcRenderer.invoke(IPC.removeQueuedPrompt, sessionId, messageId),
  compactSession: (sessionId) => ipcRenderer.invoke(IPC.compactSession, sessionId),
  listAgentResources: () => ipcRenderer.invoke(IPC.listAgentResources),
  reloadAgentResources: () => ipcRenderer.invoke(IPC.reloadAgentResources),
  setProjectResourceTrust: (trusted) => ipcRenderer.invoke(IPC.setProjectResourceTrust, trusted),
  cancelRun: (sessionId) => ipcRenderer.invoke(IPC.cancelRun, sessionId),
  onAgentEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload)
    ipcRenderer.on(IPC.agentEvent, handler)
    return () => ipcRenderer.removeListener(IPC.agentEvent, handler)
  }
}

contextBridge.exposeInMainWorld('agent', bridge)
