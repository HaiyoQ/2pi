import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ActiveModel,
  AgentBridge,
  AgentEvent,
  AgentPreferences,
  AgentResourcesSnapshot,
  AppSettings,
  ConnectionTestResult,
  ContextUsage,
  GitDiffSnapshot,
  ModelOption,
  ProviderCatalogEntry,
  ProviderDraft,
  PromptInput,
  QueuedMessageMode,
  RunContract,
  SessionSummary,
  SessionTreeSnapshot,
  TimelineActivity,
  TimelineTurn,
  TokenUsage
} from '../../../shared/contracts'
import { agentPreferencesPayload, promptInputPayload, providerDraftPayload } from './ipc-payloads'

export const useAgentStore = defineStore('agent', () => {
  const settings = ref<AppSettings>()
  const models = ref<ModelOption[]>([])
  const providerCatalog = ref<ProviderCatalogEntry[]>([])
  const sessions = ref<SessionSummary[]>([])
  const currentSession = ref<SessionSummary>()
  const sessionTree = ref<SessionTreeSnapshot>()
  const gitDiff = ref<GitDiffSnapshot>()
  const turns = ref<TimelineTurn[]>([])
  const contextUsage = ref<ContextUsage>()
  const activeContract = ref<RunContract>()
  const queuedMessages = ref<Awaited<ReturnType<AgentBridge['queuePrompt']>>['items']>([])
  const agentResources = ref<AgentResourcesSnapshot>()
  const resourceError = ref('')
  const running = ref(false)
  const transitioning = ref(false)
  const queueSubmitting = ref(false)
  const compacting = ref(false)
  const branchSubmitting = ref(false)
  const diffLoading = ref(false)
  const resourcesLoading = ref(false)
  const error = ref('')
  const initialized = ref(false)
  const lastRunState = ref<'idle' | 'running' | 'complete' | 'failed' | 'cancelled'>('idle')
  const activeRunId = ref('')
  let historySearchGeneration = 0
  let currentHistoryQuery = ''
  let initializeTask: Promise<void> | undefined

  const workspaceName = computed(() => {
    const path = settings.value?.workspace.path
    return path ? path.split(/[\\/]/).filter(Boolean).at(-1) || path : '未选择工作目录'
  })
  const activeTurn = computed(() => [...turns.value].reverse().find((turn) => turn.state === 'running'))
  const activeThinking = computed(() => activeTurn.value?.activities.some((item) => item.type === 'thinking' && item.status === 'running') ?? false)
  const activeRetry = computed(() => activeTurn.value?.activities.find((item): item is Extract<TimelineActivity, { type: 'retry' }> =>
    item.type === 'retry' && (item.status === 'waiting' || item.status === 'running')))

  async function initialize(): Promise<void> {
    if (initialized.value) return
    if (initializeTask) return initializeTask
    initializeTask = (async () => {
      const [loadedSettings, loadedModels, loadedCatalog, loadedSessions] = await Promise.all([
        window.agent.getSettings(), window.agent.listModels(), window.agent.listProviderCatalog(), window.agent.listSessions()
      ])
      settings.value = loadedSettings
      models.value = loadedModels
      providerCatalog.value = loadedCatalog
      sessions.value = loadedSessions
      window.agent.onAgentEvent(handleEvent)
      initialized.value = true
    })()
    try {
      await initializeTask
    } finally {
      initializeTask = undefined
    }
  }

  async function chooseWorkspace(): Promise<void> {
    if (running.value || transitioning.value) throw new Error('任务运行期间不能切换工作目录')
    const previousPath = settings.value?.workspace.path
    const workspace = await window.agent.selectWorkspace()
    if (workspace && settings.value) {
      settings.value = { ...settings.value, workspace }
      agentResources.value = undefined
      if (workspace.path !== previousPath) {
        currentSession.value = undefined
        turns.value = []
        sessionTree.value = undefined
        gitDiff.value = undefined
        clearRunState()
      }
    }
  }

  async function createSession(): Promise<void> {
    if (running.value || transitioning.value) throw new Error('任务运行期间不能新建会话')
    transitioning.value = true
    clearRunState()
    try {
      const snapshot = await window.agent.createSession()
      applySnapshot(snapshot)
      sessionTree.value = await window.agent.getSessionTree(snapshot.summary.id)
      await refreshSessions()
    } finally {
      transitioning.value = false
    }
  }

  async function openSession(id: string): Promise<void> {
    if (running.value || transitioning.value) throw new Error('任务运行期间不能切换会话')
    transitioning.value = true
    clearRunState()
    try {
      const snapshot = await window.agent.openSession(id)
      applySnapshot(snapshot)
      sessionTree.value = await window.agent.getSessionTree(id)
    } finally {
      transitioning.value = false
    }
  }

  async function send(value: PromptInput | string): Promise<boolean> {
    const input = typeof value === 'string' ? { text: value, images: [] } : value
    if (running.value || transitioning.value) return false
    transitioning.value = true
    error.value = ''
    try {
      if (!currentSession.value) applySnapshot(await window.agent.createSession())
      if (!currentSession.value) return false
      running.value = true
      lastRunState.value = 'running'
      setRuntimeBusy(true)
      const timestamp = new Date().toISOString()
      turns.value.push({
        id: crypto.randomUUID(),
        user: { id: crypto.randomUUID(), role: 'user', text: input.text, images: input.images, timestamp },
        assistant: { id: crypto.randomUUID(), role: 'assistant', text: '', images: [], timestamp },
        activities: [],
        state: 'running',
        usage: emptyUsage()
      })
      const result = await window.agent.sendPrompt(currentSession.value.id, promptInputPayload(input))
      if (running.value && activeTurn.value) {
        activeRunId.value = result.runId
        activeContract.value = result.contract
      }
      return true
    } catch (cause) {
      if (running.value) finishCurrentTurn('failed', errorText(cause))
      else error.value = errorText(cause)
      return false
    } finally {
      transitioning.value = false
    }
  }

  async function cancel(): Promise<void> {
    if (!currentSession.value || !running.value) return
    try {
      await window.agent.cancelRun(currentSession.value.id)
      if (running.value) finishCurrentTurn('cancelled')
    } catch (cause) {
      error.value = `中止失败：${errorText(cause)}`
    }
  }

  async function queueMessage(value: PromptInput | string, mode: QueuedMessageMode): Promise<boolean> {
    const input = typeof value === 'string' ? { text: value, images: [] } : value
    if (!currentSession.value || !running.value || queueSubmitting.value) return false
    queueSubmitting.value = true
    error.value = ''
    const requestId = crypto.randomUUID()
    try {
      const snapshot = await window.agent.queuePrompt(currentSession.value.id, requestId, promptInputPayload(input), mode)
      queuedMessages.value = snapshot.items
      return true
    } catch (cause) {
      error.value = `追加失败：${errorText(cause)}`
      return false
    } finally {
      queueSubmitting.value = false
    }
  }

  async function removeQueuedMessage(messageId: string): Promise<void> {
    if (!currentSession.value || queueSubmitting.value) return
    queueSubmitting.value = true
    try {
      const snapshot = await window.agent.removeQueuedPrompt(currentSession.value.id, messageId)
      queuedMessages.value = snapshot.items
    } catch (cause) {
      error.value = `删除待处理消息失败：${errorText(cause)}`
    } finally {
      queueSubmitting.value = false
    }
  }

  async function compactContext(): Promise<Awaited<ReturnType<AgentBridge['compactSession']>>> {
    if (!currentSession.value || running.value || transitioning.value || compacting.value) throw new Error('当前不能压缩上下文')
    compacting.value = true
    transitioning.value = true
    setRuntimeBusy(true)
    try {
      const result = await window.agent.compactSession(currentSession.value.id)
      if (result.context) contextUsage.value = result.context
      return result
    } finally {
      compacting.value = false
      transitioning.value = false
      setRuntimeBusy(false)
    }
  }

  async function searchHistory(query: string): Promise<void> {
    currentHistoryQuery = query
    const generation = ++historySearchGeneration
    const results = await window.agent.searchSessions(query)
    if (generation === historySearchGeneration) sessions.value = results
  }

  async function renameHistorySession(sessionId: string, name: string): Promise<void> {
    if (running.value || transitioning.value) throw new Error('任务运行期间不能重命名会话')
    const summary = await window.agent.renameSession(sessionId, name)
    sessions.value = sessions.value.map((item) => item.id === sessionId ? summary : item)
    if (currentSession.value?.id === sessionId) currentSession.value = summary
  }

  async function loadSessionTree(): Promise<void> {
    if (!currentSession.value) {
      sessionTree.value = undefined
      return
    }
    sessionTree.value = await window.agent.getSessionTree(currentSession.value.id)
  }

  async function branchFromNode(entryId: string): Promise<string | undefined> {
    if (!currentSession.value || running.value || transitioning.value || branchSubmitting.value) return undefined
    branchSubmitting.value = true
    transitioning.value = true
    setRuntimeBusy(true)
    const requestId = crypto.randomUUID()
    try {
      const result = await window.agent.branchSession(currentSession.value.id, requestId, entryId)
      applySnapshot(result.snapshot)
      sessionTree.value = result.tree
      await refreshSessions()
      return result.summary
    } finally {
      branchSubmitting.value = false
      transitioning.value = false
      setRuntimeBusy(false)
    }
  }

  async function loadGitDiff(): Promise<void> {
    if (diffLoading.value) return
    diffLoading.value = true
    try {
      gitDiff.value = await window.agent.getGitDiff()
    } finally {
      diffLoading.value = false
    }
  }

  async function loadAgentResources(reload = false): Promise<void> {
    if (resourcesLoading.value) return
    resourcesLoading.value = true
    resourceError.value = ''
    try {
      agentResources.value = reload
        ? await window.agent.reloadAgentResources()
        : await window.agent.listAgentResources()
    } catch (cause) {
      resourceError.value = errorText(cause)
      throw cause
    } finally {
      resourcesLoading.value = false
    }
  }

  async function setProjectResourceTrust(trusted: boolean): Promise<void> {
    if (running.value || transitioning.value || resourcesLoading.value) throw new Error('Agent 资源正在更新，请稍后再试')
    resourcesLoading.value = true
    resourceError.value = ''
    transitioning.value = true
    setRuntimeBusy(true)
    try {
      agentResources.value = await window.agent.setProjectResourceTrust(trusted)
    } catch (cause) {
      resourceError.value = errorText(cause)
      throw cause
    } finally {
      resourcesLoading.value = false
      transitioning.value = false
      setRuntimeBusy(false)
    }
  }

  async function saveProvider(draft: ProviderDraft): Promise<void> {
    settings.value = await window.agent.saveProvider(providerDraftPayload(draft))
    await refreshProviderData()
  }

  async function deleteProvider(providerId: string): Promise<void> {
    settings.value = await window.agent.deleteProvider(providerId)
    await refreshProviderData()
  }

  async function testProvider(draft: ProviderDraft): Promise<ConnectionTestResult> {
    return window.agent.testProvider(providerDraftPayload(draft))
  }

  async function activateModel(model: ActiveModel): Promise<void> {
    settings.value = await window.agent.activateModel(model)
  }

  async function saveAgentPreferences(preferences: AgentPreferences): Promise<void> {
    settings.value = await window.agent.saveAgentPreferences(agentPreferencesPayload(preferences))
  }

  async function refreshProviderData(): Promise<void> {
    const [loadedModels, loadedCatalog] = await Promise.all([window.agent.listModels(), window.agent.listProviderCatalog()])
    models.value = loadedModels
    providerCatalog.value = loadedCatalog
  }

  async function refreshSessions(): Promise<void> {
    const generation = ++historySearchGeneration
    const loaded = currentHistoryQuery
      ? await window.agent.searchSessions(currentHistoryQuery)
      : await window.agent.listSessions()
    if (generation === historySearchGeneration) sessions.value = loaded
  }

  function handleEvent(event: AgentEvent): void {
    if (event.sessionId !== currentSession.value?.id) return
    if (activeRunId.value && event.runId !== activeRunId.value) return
    if (!activeRunId.value) activeRunId.value = event.runId
    if (event.type === 'queue-updated') {
      queuedMessages.value = event.queue.items
      return
    }
    if (!running.value) return
    const turn = activeTurn.value
    if (!turn) return

    if (event.type === 'queued-message-start') {
      settleTurn(turn, 'complete')
      const timestamp = event.item.createdAt
      turns.value.push({
        id: crypto.randomUUID(),
        user: { id: crypto.randomUUID(), role: 'user', text: event.item.text, images: [], timestamp },
        assistant: { id: crypto.randomUUID(), role: 'assistant', text: '', images: [], timestamp },
        activities: [],
        state: 'running',
        usage: emptyUsage()
      })
    } else if (event.type === 'text-delta') {
      if (!turn.assistant) turn.assistant = { id: crypto.randomUUID(), role: 'assistant', text: '', images: [], timestamp: new Date().toISOString() }
      turn.assistant.text += event.delta
    } else if (event.type === 'thinking-status') {
      updateThinking(turn, event)
    } else if (event.type === 'tool-progress') {
      upsertTool(turn, event.toolCallId, event.toolName, event.summary, 'running', event.targetPath)
    } else if (event.type === 'tool-complete') {
      upsertTool(turn, event.toolCallId, event.toolName, event.summary || (event.isError ? '执行失败' : '已完成'), event.isError ? 'error' : 'complete')
    } else if (event.type === 'retry-status') {
      upsertRetry(turn, event)
    } else if (event.type === 'usage-delta') {
      addUsage(turn.usage, event.usage)
      if (event.context) contextUsage.value = event.context
    } else if (event.type === 'run-complete') {
      if (event.context) contextUsage.value = event.context
      finishCurrentTurn('complete')
      void refreshSessions()
      if (gitDiff.value) void loadGitDiff()
    } else if (event.type === 'run-failed') {
      finishCurrentTurn('failed', event.message)
      void refreshSessions()
      if (gitDiff.value) void loadGitDiff()
    } else if (event.type === 'run-cancelled') {
      finishCurrentTurn('cancelled')
      void refreshSessions()
      if (gitDiff.value) void loadGitDiff()
    }
  }

  function updateThinking(turn: TimelineTurn, event: Extract<AgentEvent, { type: 'thinking-status' }>): void {
    const runningItem = [...turn.activities].reverse().find((item): item is Extract<TimelineActivity, { type: 'thinking' }> =>
      item.type === 'thinking' && item.status === 'running')
    if (event.status === 'running') {
      if (!runningItem) turn.activities.push({ id: `thinking:${event.runId}:${turn.activities.length}`, type: 'thinking', status: 'running', timestamp: event.timestamp })
      return
    }
    if (runningItem) {
      runningItem.status = 'complete'
      runningItem.durationMs = Math.max(0, new Date(event.timestamp).valueOf() - new Date(runningItem.timestamp).valueOf())
    }
  }

  function upsertTool(turn: TimelineTurn, id: string, toolName: string, summary: string, status: Extract<TimelineActivity, { type: 'tool' }>['status'], targetPath?: string): void {
    const item = turn.activities.find((entry): entry is Extract<TimelineActivity, { type: 'tool' }> => entry.type === 'tool' && entry.toolCallId === id)
    if (item) Object.assign(item, { toolName, summary, status, ...(targetPath ? { targetPath } : {}) })
    else turn.activities.push({ id: `tool:${id}`, type: 'tool', toolCallId: id, toolName, summary, targetPath, status, timestamp: new Date().toISOString() })
  }

  function upsertRetry(turn: TimelineTurn, event: Extract<AgentEvent, { type: 'retry-status' }>): void {
    const item = turn.activities.find((entry): entry is Extract<TimelineActivity, { type: 'retry' }> => entry.type === 'retry' && entry.attempt === event.attempt)
    const value = {
      id: `retry:${event.runId}:${event.attempt}`, type: 'retry' as const,
      attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs,
      message: event.message, status: event.status, timestamp: event.timestamp
    }
    if (item) Object.assign(item, value)
    else turn.activities.push(value)
  }

  function finishCurrentTurn(state: 'complete' | 'failed' | 'cancelled', message?: string): void {
    const turn = activeTurn.value
    if (turn) settleTurn(turn, state, message)
    running.value = false
    lastRunState.value = state
    activeRunId.value = ''
    activeContract.value = undefined
    queuedMessages.value = []
    error.value = message ?? ''
    setRuntimeBusy(false)
  }

  function settleTurn(turn: TimelineTurn, state: 'complete' | 'failed' | 'cancelled', message?: string): void {
    turn.state = state
    if (message) turn.error = message
    turn.activities.forEach((item) => {
      if (item.type === 'thinking' && item.status === 'running') item.status = 'complete'
    })
    if (turn.assistant && !turn.assistant.text) turn.assistant = undefined
  }

  function clearRunState(): void {
    running.value = false
    error.value = ''
    lastRunState.value = 'idle'
    activeRunId.value = ''
    activeContract.value = undefined
    queuedMessages.value = []
    contextUsage.value = undefined
    setRuntimeBusy(false)
  }

  function applySnapshot(snapshot: Awaited<ReturnType<AgentBridge['openSession']>>): void {
    const workspaceChanged = settings.value?.workspace.path !== snapshot.summary.workspacePath
    if (settings.value && workspaceChanged) {
      settings.value = { ...settings.value, workspace: { path: snapshot.summary.workspacePath } }
      agentResources.value = undefined
      gitDiff.value = undefined
    }
    currentSession.value = snapshot.summary
    turns.value = snapshot.turns
    contextUsage.value = snapshot.context
    queuedMessages.value = []
  }

  function setRuntimeBusy(value: boolean): void {
    if (settings.value) settings.value = { ...settings.value, runtimeBusy: value }
  }

  return {
    settings, models, providerCatalog, sessions, currentSession, sessionTree, gitDiff, turns, contextUsage, activeContract,
    queuedMessages, agentResources, resourceError, running, transitioning, queueSubmitting, compacting, branchSubmitting, diffLoading, resourcesLoading,
    error, initialized, lastRunState, activeRunId, workspaceName, activeTurn, activeThinking, activeRetry,
    initialize, chooseWorkspace, createSession, openSession, send, cancel, queueMessage, removeQueuedMessage, compactContext,
    searchHistory, renameHistorySession, loadSessionTree, branchFromNode, loadGitDiff,
    loadAgentResources, setProjectResourceTrust,
    saveProvider, deleteProvider, testProvider, activateModel, saveAgentPreferences
  }
})

function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function addUsage(target: TokenUsage, delta: TokenUsage): void {
  target.input += delta.input
  target.output += delta.output
  target.cacheRead += delta.cacheRead
  target.cacheWrite += delta.cacheWrite
  target.total += delta.total
}

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
