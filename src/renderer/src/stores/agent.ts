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

export const useAgentStore = defineStore('agent', () => {
  const settings = ref<AppSettings>()
  const models = ref<ModelOption[]>([])
  const providerCatalog = ref<ProviderCatalogEntry[]>([])
  const sessions = ref<SessionSummary[]>([])
  const currentSession = ref<SessionSummary>()
  const messages = ref<ChatMessage[]>([])
  const approvals = ref<ToolApprovalRequest[]>([])
  const toolEvents = ref<Array<{ id: string; label: string; error: boolean }>>([])
  const running = ref(false)
  const error = ref('')

  const workspaceName = computed(() => {
    const path = settings.value?.workspace.path
    return path ? path.split(/[\\/]/).filter(Boolean).at(-1) || path : '未选择工作目录'
  })

  async function initialize(): Promise<void> {
    const [loadedSettings, loadedModels, loadedCatalog, loadedSessions] = await Promise.all([
      window.agent.getSettings(), window.agent.listModels(), window.agent.listProviderCatalog(), window.agent.listSessions()
    ])
    settings.value = loadedSettings
    models.value = loadedModels
    providerCatalog.value = loadedCatalog
    sessions.value = loadedSessions
    window.agent.onAgentEvent(handleEvent)
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
      running.value = true
      messages.value.push({ id: crypto.randomUUID(), role: 'user', text, timestamp: new Date().toISOString() })
      messages.value.push({ id: crypto.randomUUID(), role: 'assistant', text: '', timestamp: new Date().toISOString() })
      await window.agent.sendPrompt(currentSession.value.id, text)
      return true
    } catch (cause) {
      running.value = false
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
    if (event.type === 'text-delta') {
      const assistant = [...messages.value].reverse().find((item) => item.role === 'assistant')
      if (assistant) assistant.text += event.delta
    } else if (event.type === 'tool-request') {
      approvals.value.push(event.request)
    } else if (event.type === 'tool-progress') {
      upsertTool(event.toolCallId, `${event.toolName} · ${event.summary}`, false)
    } else if (event.type === 'tool-complete') {
      upsertTool(event.toolCallId, `${event.toolName} · ${event.isError ? '执行失败' : '已完成'}`, event.isError)
    } else if (event.type === 'run-complete') {
      running.value = false
      void refreshSessions()
    } else if (event.type === 'run-failed') {
      running.value = false
      error.value = event.message
      removeTrailingEmptyAssistant()
    }
  }

  function upsertTool(id: string, label: string, isError: boolean): void {
    const item = toolEvents.value.find((entry) => entry.id === id)
    if (item) Object.assign(item, { label, error: isError })
    else toolEvents.value.push({ id, label, error: isError })
  }

  function clearRunState(): void {
    approvals.value = []
    toolEvents.value = []
    running.value = false
    error.value = ''
  }

  function removeTrailingEmptyAssistant(): void {
    const last = messages.value.at(-1)
    if (last?.role === 'assistant' && !last.text) messages.value.pop()
  }

  return {
    settings, models, providerCatalog, sessions, currentSession, messages, approvals, toolEvents, running, error, workspaceName,
    initialize, chooseWorkspace, createSession, openSession, send, decide, cancel,
    saveProvider, deleteProvider, testProvider, activateModel
  }
})

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
