import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ActiveModel,
  AgentEvent,
  AppSettings,
  ChatMessage,
  ConnectionTestResult,
  ModelOption,
  ProviderCatalogEntry,
  ProviderDraft,
  SessionSummary,
  ToolApprovalRequest
} from '../../../shared/contracts'

export interface ToolEventView {
  id: string
  toolName: string
  summary: string
  status: 'running' | 'complete' | 'error'
}

export const useAgentStore = defineStore('agent', () => {
  const settings = ref<AppSettings>()
  const models = ref<ModelOption[]>([])
  const providerCatalog = ref<ProviderCatalogEntry[]>([])
  const sessions = ref<SessionSummary[]>([])
  const currentSession = ref<SessionSummary>()
  const messages = ref<ChatMessage[]>([])
  const approvals = ref<ToolApprovalRequest[]>([])
  const toolEvents = ref<ToolEventView[]>([])
  const running = ref(false)
  const error = ref('')
  const initialized = ref(false)
  const lastRunState = ref<'idle' | 'running' | 'complete' | 'failed' | 'cancelled'>('idle')
  const activeRunId = ref('')

  const workspaceName = computed(() => {
    const path = settings.value?.workspace.path
    return path ? path.split(/[\\/]/).filter(Boolean).at(-1) || path : '未选择工作目录'
  })

  async function initialize(): Promise<void> {
    if (initialized.value) return
    const [loadedSettings, loadedModels, loadedCatalog, loadedSessions] = await Promise.all([
      window.agent.getSettings(), window.agent.listModels(), window.agent.listProviderCatalog(), window.agent.listSessions()
    ])
    settings.value = loadedSettings
    models.value = loadedModels
    providerCatalog.value = loadedCatalog
    sessions.value = loadedSessions
    window.agent.onAgentEvent(handleEvent)
    initialized.value = true
  }

  async function chooseWorkspace(): Promise<void> {
    const workspace = await window.agent.selectWorkspace()
    if (workspace && settings.value) settings.value = { ...settings.value, workspace }
  }

  async function createSession(): Promise<void> {
    clearRunState()
    const snapshot = await window.agent.createSession()
    currentSession.value = snapshot.summary
    messages.value = snapshot.messages
    await refreshSessions()
  }

  async function openSession(id: string): Promise<void> {
    clearRunState()
    const snapshot = await window.agent.openSession(id)
    currentSession.value = snapshot.summary
    messages.value = snapshot.messages
  }

  async function send(text: string): Promise<boolean> {
    error.value = ''
    try {
      if (!currentSession.value) await createSession()
      if (!currentSession.value) return false
      approvals.value = []
      toolEvents.value = []
      running.value = true
      lastRunState.value = 'running'
      messages.value.push({ id: crypto.randomUUID(), role: 'user', text, timestamp: new Date().toISOString() })
      messages.value.push({ id: crypto.randomUUID(), role: 'assistant', text: '', timestamp: new Date().toISOString() })
      const result = await window.agent.sendPrompt(currentSession.value.id, text)
      activeRunId.value = result.runId
      return true
    } catch (cause) {
      running.value = false
      lastRunState.value = 'failed'
      activeRunId.value = ''
      error.value = errorText(cause)
      removeTrailingEmptyAssistant()
      return false
    }
  }

  async function decide(request: ToolApprovalRequest, decision: 'approved' | 'rejected'): Promise<void> {
    const result = await window.agent.decideApproval(request.requestId, decision)
    const index = approvals.value.findIndex((item) => item.requestId === result.requestId)
    if (index >= 0) approvals.value[index] = result
  }

  async function cancel(): Promise<void> {
    if (!currentSession.value) return
    await window.agent.cancelRun(currentSession.value.id)
    running.value = false
    lastRunState.value = 'cancelled'
    activeRunId.value = ''
    removeTrailingEmptyAssistant()
  }

  async function saveProvider(draft: ProviderDraft): Promise<void> {
    settings.value = await window.agent.saveProvider(draft)
    await refreshProviderData()
  }

  async function deleteProvider(providerId: string): Promise<void> {
    settings.value = await window.agent.deleteProvider(providerId)
    await refreshProviderData()
  }

  async function testProvider(draft: ProviderDraft): Promise<ConnectionTestResult> {
    return window.agent.testProvider(draft)
  }

  async function activateModel(model: ActiveModel): Promise<void> {
    settings.value = await window.agent.activateModel(model)
  }

  async function refreshProviderData(): Promise<void> {
    const [loadedModels, loadedCatalog] = await Promise.all([window.agent.listModels(), window.agent.listProviderCatalog()])
    models.value = loadedModels
    providerCatalog.value = loadedCatalog
  }

  async function refreshSessions(): Promise<void> {
    sessions.value = await window.agent.listSessions()
  }

  function handleEvent(event: AgentEvent): void {
    if (event.sessionId !== currentSession.value?.id) return
    if (!running.value) return
    if (activeRunId.value && event.runId !== activeRunId.value) return
    if (!activeRunId.value) activeRunId.value = event.runId
    if (event.type === 'text-delta') {
      const assistant = [...messages.value].reverse().find((item) => item.role === 'assistant')
      if (assistant) assistant.text += event.delta
    } else if (event.type === 'tool-request') {
      approvals.value.push(event.request)
    } else if (event.type === 'tool-progress') {
      upsertTool(event.toolCallId, event.toolName, event.summary, 'running')
    } else if (event.type === 'tool-complete') {
      upsertTool(event.toolCallId, event.toolName, event.summary || (event.isError ? '执行失败' : '已完成'), event.isError ? 'error' : 'complete')
    } else if (event.type === 'run-complete') {
      running.value = false
      lastRunState.value = 'complete'
      activeRunId.value = ''
      void refreshSessions()
    } else if (event.type === 'run-failed') {
      running.value = false
      lastRunState.value = 'failed'
      activeRunId.value = ''
      error.value = event.message
      removeTrailingEmptyAssistant()
    }
  }

  function upsertTool(id: string, toolName: string, summary: string, status: ToolEventView['status']): void {
    const item = toolEvents.value.find((entry) => entry.id === id)
    if (item) Object.assign(item, { toolName, summary, status })
    else toolEvents.value.push({ id, toolName, summary, status })
  }

  function clearRunState(): void {
    approvals.value = []
    toolEvents.value = []
    running.value = false
    error.value = ''
    lastRunState.value = 'idle'
    activeRunId.value = ''
  }

  function removeTrailingEmptyAssistant(): void {
    const last = messages.value.at(-1)
    if (last?.role === 'assistant' && !last.text) messages.value.pop()
  }

  return {
    settings, models, providerCatalog, sessions, currentSession, messages, approvals, toolEvents, running, error,
    initialized, lastRunState, activeRunId, workspaceName,
    initialize, chooseWorkspace, createSession, openSession, send, decide, cancel,
    saveProvider, deleteProvider, testProvider, activateModel
  }
})

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
