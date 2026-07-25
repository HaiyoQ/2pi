import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type ProviderConfig,
  type SessionInfo,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import type { ImageContent } from '@earendil-works/pi-ai'
import { AGENT_TOOL_NAMES } from '../../shared/contracts'
import type {
  AgentEvent,
  ActiveModel,
  AgentPreferences,
  AgentResourcesSnapshot,
  AgentToolName,
  AppSettings,
  BranchSessionResult,
  CompactionSummary,
  ConnectionTestResult,
  ContextUsage,
  GitDiffSnapshot,
  ModelOption,
  ProviderCatalogEntry,
  ProviderConnectionDraft,
  ProviderDraft,
  ProviderProfile,
  ProviderProtocol,
  PromptInput,
  QueueSnapshot,
  QueuedMessage,
  QueuedMessageMode,
  RunContract,
  SessionSnapshot,
  SessionSummary,
  SessionTreeSnapshot,
  WorkspaceConfig
} from '../../shared/contracts'
import { mapSdkEvent } from './event-mapper'
import { friendlyError } from './validation'
import type { SettingsStore } from './settings-store'
import { testProviderConnection } from './provider-discovery'
import { createPowerShellOperations } from './windows-shell'
import { buildSessionTimeline, RETRY_ENTRY_TYPE, RUN_ERROR_ENTRY_TYPE, type PersistedRetryEvent } from './session-timeline'
import { loadAgentResources, refreshAgentResourceSnapshot, updateProjectTrust, type AgentResourceState } from './agent-resources'
import { RunQueue } from './run-queue'
import { getGitDiffSnapshot } from './git-diff'
import { appendBranchRequest, branchRequestLabel, createSessionTreeSnapshot, findBranchRequest, recoverBranchRequest } from './session-history'

const READ_ONLY_TOOLS = new Set<AgentToolName>(['read', 'grep', 'find', 'ls'])

interface CurrentRun {
  sessionId: string
  runId: string
  contract: RunContract
  lastError?: string
  retry?: PersistedRetryEvent
}

export class AgentRuntime {
  private modelRuntime?: ModelRuntime
  private session?: AgentSession
  private currentRun?: CurrentRun
  private readonly runQueue = new RunQueue()
  private consumedQueue: QueuedMessage[] = []
  private resourceState?: AgentResourceState
  private compactionTask?: { sessionId: string; promise: Promise<CompactionSummary> }
  private branchTask?: { sessionId: string; requestId: string; promise: Promise<BranchSessionResult> }
  private queueMutation: Promise<void> = Promise.resolve()
  private catalog: ProviderCatalogEntry[] = []
  private unsubscribe?: () => void
  private readonly listeners = new Set<(event: AgentEvent) => void>()

  constructor(
    private readonly userDataPath: string,
    private readonly settings: SettingsStore
  ) {}

  private get agentDir(): string { return join(this.userDataPath, 'agent') }
  private get sessionDir(): string { return join(this.userDataPath, 'sessions') }

  async initialize(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true })
    this.modelRuntime = await ModelRuntime.create({
      authPath: join(this.agentDir, 'sdk-auth.json'),
      modelsPath: null,
      allowModelNetwork: false
    })
    this.catalog = buildCatalog(this.modelRuntime)
    for (const provider of this.settings.get().providers) await this.registerProvider(provider)
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSettings(): AppSettings {
    return this.settings.get(this.isBusy())
  }

  listProviderCatalog(): ProviderCatalogEntry[] {
    const configured = new Set(this.settings.get().providers.filter((item) => item.type === 'builtin').map((item) => item.id))
    return this.catalog.filter((item) => !configured.has(item.id)).map((item) => ({
      ...item, models: item.models.map((model) => ({ ...model }))
    }))
  }

  async saveProvider(draft: ProviderDraft): Promise<AppSettings> {
    this.requireIdle('运行期间不能修改供应商')
    const previousActive = this.settings.get().activeModel
    const saved = await this.settings.saveProvider(draft)
    await this.registerProvider(saved)
    const active = this.settings.get().activeModel
    if (active?.providerId === saved.id) await this.applySessionModel(active)
    else if (previousActive?.providerId === saved.id) this.releaseSession()
    return this.getSettings()
  }

  async deleteProvider(providerId: string): Promise<AppSettings> {
    this.requireIdle('运行期间不能删除供应商')
    const wasActive = this.settings.get().activeModel?.providerId === providerId
    await this.settings.deleteProvider(providerId)
    const runtime = this.requireModelRuntime()
    runtime.unregisterProvider(providerId)
    await runtime.removeRuntimeApiKey(providerId)
    if (wasActive) this.releaseSession()
    return this.getSettings()
  }

  async testProvider(draft: ProviderConnectionDraft): Promise<ConnectionTestResult> {
    const existing = draft.id ? this.settings.getProviderSecrets(draft.id) : { headers: {} }
    const headers = Object.fromEntries(draft.headers.map((item) => [item.name, item.value ?? existing.headers[item.name] ?? '']))
    return testProviderConnection({
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      apiKey: draft.clearApiKey ? undefined : draft.apiKey ?? existing.apiKey,
      headers
    })
  }

  async activateModel(model: ActiveModel): Promise<AppSettings> {
    this.requireIdle('运行期间不能切换模型')
    await this.settings.activateModel(model)
    await this.applySessionModel(model)
    return this.getSettings()
  }

  async saveAgentPreferences(preferences: AgentPreferences): Promise<AppSettings> {
    this.requireIdle('运行期间不能修改 Agent 设置')
    await this.settings.saveAgentPreferences(preferences)
    this.applyAgentPreferences()
    return this.getSettings()
  }

  async saveWorkspace(path: string): Promise<WorkspaceConfig> {
    this.requireIdle('运行期间不能切换工作目录')
    await this.settings.saveWorkspace(path)
    if (this.session && this.session.sessionManager.getCwd() !== path) this.releaseSession()
    return { path }
  }

  listModels(): ModelOption[] {
    const runtime = this.requireModelRuntime()
    return this.settings.get().providers.flatMap((provider) => provider.models.flatMap((configured) => {
      const model = runtime.getModel(provider.id, configured.id)
      return model ? [{
        providerId: provider.id, modelId: model.id, providerName: provider.name, label: model.name,
        reasoning: model.reasoning, input: [...(model.input ?? ['text'])], contextWindow: model.contextWindow ?? 128_000,
        maxTokens: model.maxTokens, toolUse: configured.toolUse !== false
      }] : []
    }))
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessions = await SessionManager.listAll(this.sessionDir)
    return sessions.map(toSummary)
  }

  async searchSessions(query: string): Promise<SessionSummary[]> {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return this.listSessions()
    const sessions = await SessionManager.listAll(this.sessionDir)
    return sessions.filter((item) => [item.name, item.firstMessage, item.allMessagesText, item.cwd]
      .some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalized))).map(toSummary)
  }

  async createSession(): Promise<SessionSnapshot> {
    this.requireIdle('任务运行期间不能新建会话')
    const workspace = this.requireWorkspace()
    const manager = SessionManager.create(workspace, this.sessionDir)
    await this.bindSession(manager)
    return this.snapshot()
  }

  async openSession(sessionId: string): Promise<SessionSnapshot> {
    this.requireIdle('任务运行期间不能切换会话')
    const sessions = await SessionManager.listAll(this.sessionDir)
    const found = sessions.find((item) => item.id === sessionId)
    if (!found) throw new Error('会话不存在')
    const workspace = found.cwd || this.requireWorkspace()
    const workspaceChanged = workspace !== this.settings.get().workspace.path
    await this.bindSession(
      SessionManager.open(found.path, this.sessionDir, workspace),
      workspaceChanged ? async () => { await this.settings.saveWorkspace(workspace) } : undefined
    )
    return this.snapshot()
  }

  async renameSession(sessionId: string, name: string): Promise<SessionSummary> {
    this.requireIdle('任务运行期间不能重命名会话')
    const manager = await this.sessionManagerFor(sessionId)
    if (manager.getSessionName() !== name) {
      if (this.session?.sessionId === sessionId) this.session.setSessionName(name)
      else manager.appendSessionInfo(name)
    }
    if (this.session?.sessionId === sessionId) return this.snapshot().summary
    const updated = (await SessionManager.listAll(this.sessionDir)).find((item) => item.id === sessionId)
    if (!updated) throw new Error('会话不存在')
    return toSummary(updated)
  }

  async getSessionTree(sessionId: string): Promise<SessionTreeSnapshot> {
    return createSessionTreeSnapshot(await this.sessionManagerFor(sessionId))
  }

  async branchSession(sessionId: string, requestId: string, entryId: string): Promise<BranchSessionResult> {
    if (this.branchTask?.sessionId === sessionId && this.branchTask.requestId === requestId) return this.branchTask.promise
    if (!this.session || this.session.sessionId !== sessionId) throw new Error('请先打开会话')
    this.requireIdle('当前有其他操作正在进行')
    const session = this.session
    const promise = (async (): Promise<BranchSessionResult> => {
      const manager = session.sessionManager
      const existing = findBranchRequest(manager, requestId)
      if (existing?.targetId !== undefined && existing.targetId !== entryId) throw new Error('分支请求 ID 已用于其他历史节点')
      if (existing?.status === 'complete') return { snapshot: this.snapshot(), tree: createSessionTreeSnapshot(manager) }
      if (existing?.status === 'pending') {
        const recovered = recoverBranchRequest(manager, existing)
        if (recovered.completed) {
          appendBranchRequest(manager, { requestId, targetId: entryId, status: 'complete', summaryEntryId: recovered.summaryEntryId })
          return { snapshot: this.snapshot(), tree: createSessionTreeSnapshot(manager), summary: recovered.summary }
        }
      }
      const node = createSessionTreeSnapshot(manager).nodes.find((item) => item.id === entryId)
      if (!node) throw new Error('找不到所选历史节点')
      if (!node.branchable) throw new Error('请选择 Agent 回复、工具结果或摘要节点创建分支')
      if (!existing) appendBranchRequest(manager, { requestId, targetId: entryId, status: 'pending' })
      const result = await session.navigateTree(entryId, { summarize: true, label: branchRequestLabel(requestId) })
      if (result.cancelled) throw new Error(result.aborted ? '分支摘要已中止' : '分支操作已取消')
      appendBranchRequest(manager, { requestId, targetId: entryId, status: 'complete', summaryEntryId: result.summaryEntry?.id })
      return {
        snapshot: this.snapshot(),
        tree: createSessionTreeSnapshot(manager),
        summary: result.summaryEntry?.summary
      }
    })()
    this.branchTask = { sessionId, requestId, promise }
    try {
      return await promise
    } finally {
      if (this.branchTask?.promise === promise) this.branchTask = undefined
    }
  }

  async getGitDiff(): Promise<GitDiffSnapshot> {
    const workspace = this.session?.sessionManager.getCwd() || this.settings.get().workspace.path || undefined
    return getGitDiffSnapshot(workspace)
  }

  async sendPrompt(sessionId: string, input: PromptInput): Promise<{ runId: string; contract: RunContract }> {
    if (!this.session || this.session.sessionId !== sessionId) throw new Error('请先打开会话')
    if (this.currentRun || this.session.isStreaming) throw new Error('当前任务仍在运行')
    const runId = randomUUID()
    const contract = this.createRunContract()
    this.requireImageSupport(contract, input)
    this.applyAgentPreferences()
    this.runQueue.clear(this.session)
    this.consumedQueue = []
    this.currentRun = { sessionId, runId, contract }
    void this.session.prompt(input.text, { images: toSdkImages(input.images) }).catch((error) => {
      if (this.currentRun?.runId !== runId) return
      const message = friendlyError(error)
      this.session?.sessionManager.appendCustomEntry(RUN_ERROR_ENTRY_TYPE, { runId, message })
      this.emit({ type: 'run-failed', sessionId, runId, message })
      this.currentRun = undefined
    })
    return { runId, contract }
  }

  async queuePrompt(sessionId: string, requestId: string, input: PromptInput, mode: QueuedMessageMode): Promise<QueueSnapshot> {
    return this.mutateQueue(async () => {
      if (!this.session || this.session.sessionId !== sessionId) throw new Error('请先打开会话')
      const run = this.currentRun
      if (!run || !this.session.isStreaming) throw new Error('当前没有可追加消息的运行任务')
      this.requireImageSupport(run.contract, input)
      if (input.images.length) throw new Error('运行中的追加消息暂不支持图片，请在新任务中发送')
      const currentQueue = this.runQueue.snapshot()
      if (currentQueue.items.some((item) => item.id === requestId)) return currentQueue
      if (currentQueue.items.length >= 50) throw new Error('待处理消息已达到 50 条，请先删除部分消息')
      const snapshot = await this.runQueue.enqueue(this.session, requestId, input.text, mode)
      this.emit({ type: 'queue-updated', sessionId, runId: run.runId, queue: snapshot })
      return snapshot
    })
  }

  async removeQueuedPrompt(sessionId: string, messageId: string): Promise<QueueSnapshot> {
    return this.mutateQueue(async () => {
      if (!this.session || this.session.sessionId !== sessionId) return { items: [] }
      const run = this.currentRun
      if (!run) return this.runQueue.clear()
      const snapshot = await this.runQueue.remove(this.session, messageId)
      this.emit({ type: 'queue-updated', sessionId, runId: run.runId, queue: snapshot })
      return snapshot
    })
  }

  async compactSession(sessionId: string): Promise<CompactionSummary> {
    if (this.compactionTask?.sessionId === sessionId) return this.compactionTask.promise
    if (!this.session || this.session.sessionId !== sessionId) throw new Error('请先打开会话')
    this.requireIdle('任务运行期间不能压缩上下文')
    const session = this.session
    const before = this.getContextUsage()
    const promise = session.compact().then((result): CompactionSummary => {
      const estimatedTokensAfter = result.estimatedTokensAfter ?? null
      const context = this.getContextUsage() ?? (before ? {
        tokens: estimatedTokensAfter,
        contextWindow: before.contextWindow,
        percent: estimatedTokensAfter === null ? null : estimatedTokensAfter / before.contextWindow * 100
      } : undefined)
      return { tokensBefore: result.tokensBefore, estimatedTokensAfter, context }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (/already compacted/i.test(message)) throw new Error('当前上下文已经压缩，无需重复操作')
      if (/nothing to compact|session too small/i.test(message)) throw new Error('当前会话内容还不需要压缩')
      throw error
    })
    this.compactionTask = { sessionId, promise }
    try {
      return await promise
    } finally {
      if (this.compactionTask?.promise === promise) this.compactionTask = undefined
    }
  }

  async listAgentResources(): Promise<AgentResourcesSnapshot> {
    const cwd = this.resourceCwd()
    if (!this.resourceState || this.resourceState.snapshot.workspacePath !== cwd) {
      this.resourceState = await loadAgentResources({ cwd, agentDir: this.agentDir })
    }
    return this.resourceSnapshot()
  }

  async reloadAgentResources(): Promise<AgentResourcesSnapshot> {
    this.requireIdle('任务运行期间不能重新加载 Agent 资源')
    if (this.session) {
      const manager = this.session.sessionManager
      await this.bindSession(manager)
    } else {
      this.resourceState = await loadAgentResources({ cwd: this.resourceCwd(), agentDir: this.agentDir })
    }
    return this.resourceSnapshot()
  }

  async setProjectResourceTrust(trusted: boolean): Promise<AgentResourcesSnapshot> {
    this.requireIdle('任务运行期间不能修改项目资源信任')
    const cwd = this.requireWorkspace()
    updateProjectTrust(cwd, this.agentDir, trusted)
    this.resourceState = undefined
    if (this.session && this.session.sessionManager.getCwd() === cwd) {
      const manager = this.session.sessionManager
      await this.bindSession(manager)
    } else {
      this.resourceState = await loadAgentResources({ cwd, agentDir: this.agentDir })
    }
    return this.resourceSnapshot()
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.session || this.session.sessionId !== sessionId) return
    const session = this.session
    const run = await this.mutateQueue(async () => {
      if (this.session !== session) return undefined
      const activeRun = this.currentRun
      this.runQueue.clear(session)
      this.consumedQueue = []
      if (activeRun) this.emit({ type: 'queue-updated', sessionId, runId: activeRun.runId, queue: { items: [] } })
      this.currentRun = undefined
      return activeRun
    })
    await session.abort()
    if (run) this.emit({ type: 'run-cancelled', sessionId, runId: run.runId })
  }

  private async bindSession(manager: SessionManager, beforeCommit?: () => Promise<void>): Promise<void> {
    const runtime = this.requireModelRuntime()
    const active = this.settings.get().activeModel
    if (!active) throw new Error('请先在模型设置中选择一个模型')
    const model = runtime.getModel(active.providerId, active.modelId)
    if (!model) throw new Error('找不到所选模型，请在设置中重新选择')

    const resourceState = await loadAgentResources({
      cwd: manager.getCwd(),
      agentDir: this.agentDir,
      appendSystemPrompt: ['当前运行环境是 Windows 桌面应用。终端命令请使用 PowerShell 语法，并优先使用对中文及空格路径安全的写法。']
    })
    const loader = resourceState.loader
    const cwd = manager.getCwd()
    const customTools = [
      createReadToolDefinition(cwd),
      createGrepToolDefinition(cwd),
      createFindToolDefinition(cwd),
      createLsToolDefinition(cwd),
      createEditToolDefinition(cwd),
      createWriteToolDefinition(cwd),
      createBashToolDefinition(cwd, process.platform === 'win32' ? { operations: createPowerShellOperations() } : undefined)
    ] as unknown as ToolDefinition[]
    const result = await createAgentSession({
      cwd: manager.getCwd(),
      agentDir: this.agentDir,
      modelRuntime: runtime,
      model,
      sessionManager: manager,
      resourceLoader: loader,
      settingsManager: resourceState.settingsManager,
      noTools: 'builtin',
      customTools,
      tools: this.resolveEffectiveTools(active),
      thinkingLevel: this.settings.get().agent.thinkingLevel
    })

    let unsubscribe: (() => void) | undefined
    try {
      result.session.setAutoRetryEnabled(this.settings.get().agent.autoRetry)
      unsubscribe = result.session.subscribe((sdkEvent) => {
        const run = this.currentRun
        if (!run) return
        if (sdkEvent.type === 'queue_update') {
          const consumed = this.runQueue.reconcile(sdkEvent.steering.length, sdkEvent.followUp.length)
          this.consumedQueue.push(...consumed)
          this.emit({ type: 'queue-updated', sessionId: run.sessionId, runId: run.runId, queue: this.runQueue.snapshot() })
        } else if (sdkEvent.type === 'message_start' && sdkEvent.message.role === 'user') {
          const item = this.consumedQueue.shift()
          if (item) this.emit({ type: 'queued-message-start', sessionId: run.sessionId, runId: run.runId, item })
        }
        if (sdkEvent.type === 'message_end') {
          const message = sdkEvent.message as { role?: string; stopReason?: string; errorMessage?: string }
          if (message.role === 'assistant' && message.stopReason === 'error') {
            run.lastError = friendlyError(message.errorMessage || '模型响应失败')
          }
        }
        if (sdkEvent.type === 'auto_retry_start') {
          run.retry = {
            runId: run.runId,
            attempt: sdkEvent.attempt,
            maxAttempts: sdkEvent.maxAttempts,
            delayMs: sdkEvent.delayMs,
            message: friendlyError(sdkEvent.errorMessage),
            status: 'waiting'
          }
          this.emitRetry(run, run.retry)
        } else if (sdkEvent.type === 'agent_start' && run.retry?.status === 'waiting') {
          run.retry = { ...run.retry, status: 'running' }
          this.emitRetry(run, run.retry)
        } else if (sdkEvent.type === 'auto_retry_end' && run.retry) {
          run.retry = {
            ...run.retry,
            attempt: sdkEvent.attempt,
            message: sdkEvent.finalError ? friendlyError(sdkEvent.finalError) : run.retry.message,
            status: sdkEvent.success ? 'succeeded' : 'failed'
          }
          if (sdkEvent.success) run.lastError = undefined
          this.emitRetry(run, run.retry)
        }
        const event = mapSdkEvent(sdkEvent, run.sessionId, run.runId, this.getContextUsage())
        if (event) this.emit(event)
        if (sdkEvent.type === 'agent_settled' && this.currentRun?.runId === run.runId) {
          const error = lastAssistantError(result.session) ?? run.lastError
          this.emit(error
            ? { type: 'run-failed', sessionId: run.sessionId, runId: run.runId, message: error }
            : { type: 'run-complete', sessionId: run.sessionId, runId: run.runId, context: this.getContextUsage() })
          this.currentRun = undefined
        }
      })
      await beforeCommit?.()
    } catch (error) {
      unsubscribe?.()
      result.session.dispose()
      throw error
    }

    this.unsubscribe?.()
    this.session?.dispose()
    this.currentRun = undefined
    this.runQueue.clear()
    this.consumedQueue = []
    this.resourceState = resourceState
    this.session = result.session
    this.unsubscribe = unsubscribe
  }

  private snapshot(): SessionSnapshot {
    if (!this.session) throw new Error('会话尚未打开')
    const manager = this.session.sessionManager
    const header = manager.getHeader()
    const now = header?.timestamp ?? new Date().toISOString()
    const turns = buildSessionTimeline(manager)
    const path = manager.getSessionFile() ?? ''
    return {
      summary: {
        id: manager.getSessionId(),
        name: manager.getSessionName() || turns[0]?.user.text.slice(0, 28) || '新会话',
        path,
        workspacePath: manager.getCwd(),
        createdAt: now,
        updatedAt: manager.getBranch().at(-1)?.timestamp ?? now,
        messageCount: turns.reduce((count, turn) => count + 1 + (turn.assistant ? 1 : 0), 0)
      },
      turns,
      context: this.getContextUsage()
    }
  }

  private emitRetry(run: CurrentRun, retry: PersistedRetryEvent): void {
    this.session?.sessionManager.appendCustomEntry(RETRY_ENTRY_TYPE, retry)
    this.emit({
      type: 'retry-status', sessionId: run.sessionId, runId: run.runId,
      attempt: retry.attempt, maxAttempts: retry.maxAttempts, delayMs: retry.delayMs,
      message: retry.message, status: retry.status, timestamp: new Date().toISOString()
    })
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private requireModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error('Agent 运行时尚未初始化')
    return this.modelRuntime
  }

  private requireWorkspace(): string {
    const workspace = this.settings.get().workspace.path
    if (!workspace) throw new Error('请先选择工作目录')
    return workspace
  }

  private async sessionManagerFor(sessionId: string): Promise<SessionManager> {
    if (this.session?.sessionId === sessionId) return this.session.sessionManager
    const found = (await SessionManager.listAll(this.sessionDir)).find((item) => item.id === sessionId)
    if (!found) throw new Error('会话不存在')
    return SessionManager.open(found.path, this.sessionDir, found.cwd || undefined)
  }

  private createRunContract(): RunContract {
    const settings = this.settings.get()
    const active = settings.activeModel
    if (!active) throw new Error('请先在模型设置中选择一个模型')
    return {
      ...settings.agent,
      enabledTools: [...settings.agent.enabledTools],
      effectiveTools: this.resolveEffectiveTools(active),
      providerId: active.providerId,
      modelId: active.modelId
    }
  }

  private requireImageSupport(contract: RunContract, input: PromptInput): void {
    if (!input.images.length) return
    const provider = this.settings.getProvider(contract.providerId)
    const model = provider?.models.find((item) => item.id === contract.modelId)
    if (!model?.input?.includes('image')) throw new Error('当前模型不支持图片输入，请在模型设置中确认其输入能力')
  }

  private applyAgentPreferences(): void {
    if (!this.session) return
    const preferences = this.settings.get().agent
    const active = this.settings.get().activeModel
    this.session.setActiveToolsByName(active ? this.resolveEffectiveTools(active) : [])
    this.session.setThinkingLevel(preferences.thinkingLevel)
    this.session.setAutoRetryEnabled(preferences.autoRetry)
  }

  private getContextUsage(): ContextUsage | undefined {
    const usage = this.session?.getContextUsage()
    return usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : undefined
  }

  private resourceCwd(): string {
    return this.session?.sessionManager.getCwd() || this.settings.get().workspace.path || this.userDataPath
  }

  private resolveEffectiveTools(active: ActiveModel): AgentToolName[] {
    const model = this.settings.getProvider(active.providerId)?.models.find((item) => item.id === active.modelId)
    return resolveEffectiveTools(this.settings.get().agent, model?.toolUse !== false)
  }

  private resourceSnapshot(): AgentResourcesSnapshot {
    if (!this.resourceState) throw new Error('Agent 资源尚未加载')
    const snapshot = structuredClone(refreshAgentResourceSnapshot(this.resourceState))
    if (!this.settings.get().workspace.path && !this.session) {
      snapshot.workspacePath = undefined
      snapshot.projectResourcePath = undefined
      snapshot.trust = { required: false, decision: 'unset' }
      snapshot.resources = snapshot.resources.filter((item) => item.scope === 'user')
    }
    return snapshot
  }

  private mutateQueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queueMutation.then(operation, operation)
    this.queueMutation = task.then(() => undefined, () => undefined)
    return task
  }

  private async registerProvider(profile: ProviderProfile): Promise<void> {
    const runtime = this.requireModelRuntime()
    const secrets = this.settings.getProviderSecrets(profile.id)
    const config: ProviderConfig = {
      name: profile.name,
      baseUrl: profile.baseUrl,
      apiKey: profile.type === 'custom' && !secrets.apiKey ? 'local-no-key' : undefined,
      api: toSdkApi(profile.protocol),
      headers: secrets.headers,
      authHeader: false,
      models: profile.models.map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input ?? ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? 128_000,
        maxTokens: model.maxTokens ?? 16_000
      }))
    }
    runtime.registerProvider(profile.id, config)
    if (secrets.apiKey) await runtime.setRuntimeApiKey(profile.id, secrets.apiKey, { allowNetwork: false })
    else await runtime.removeRuntimeApiKey(profile.id)
  }

  private async applySessionModel(active: ActiveModel): Promise<void> {
    if (!this.session) return
    const model = this.requireModelRuntime().getModel(active.providerId, active.modelId)
    if (!model) {
      this.releaseSession()
      return
    }
    await this.session.setModel(model)
  }

  private isBusy(): boolean {
    return Boolean(this.currentRun || this.session?.isStreaming || this.compactionTask || this.branchTask || this.session?.isCompacting)
  }

  private requireIdle(message: string): void {
    if (this.isBusy()) throw new Error(message)
  }

  private releaseSession(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.session?.dispose()
    this.session = undefined
    this.currentRun = undefined
    this.branchTask = undefined
    this.runQueue.clear()
    this.consumedQueue = []
    this.resourceState = undefined
  }
}

function toSdkImages(images: PromptInput['images']): ImageContent[] | undefined {
  return images.length ? images.map((image) => ({ type: 'image', data: image.data, mimeType: image.mimeType })) : undefined
}

function toSdkApi(protocol: ProviderProtocol): 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai' {
  return protocol === 'openai-chat' ? 'openai-completions' : protocol
}

function buildCatalog(runtime: ModelRuntime): ProviderCatalogEntry[] {
  return runtime.getProviders().flatMap((provider) => {
    if (!provider.auth.apiKey?.login) return []
    const models = provider.getModels()
    const protocol = models[0] ? fromSdkApi(models[0].api) : undefined
    if (!protocol || !provider.baseUrl) return []
    return [{
      id: provider.id,
      name: provider.name,
      protocol,
      baseUrl: provider.baseUrl,
      models: []
    }]
  }).sort((a, b) => a.name.localeCompare(b.name))
}

function fromSdkApi(api: string): ProviderProtocol | undefined {
  if (api === 'openai-completions') return 'openai-chat'
  if (api === 'openai-responses' || api === 'anthropic-messages' || api === 'google-generative-ai') return api
  return undefined
}

function toSummary(info: SessionInfo): SessionSummary {
  return {
    id: info.id,
    name: info.name || info.firstMessage.slice(0, 28) || '新会话',
    path: info.path,
    workspacePath: info.cwd,
    createdAt: info.created.toISOString(),
    updatedAt: info.modified.toISOString(),
    messageCount: info.messageCount
  }
}

export function resolveEffectiveTools(preferences: AgentPreferences, modelAllowsTools = true): AgentToolName[] {
  if (!modelAllowsTools) return []
  const enabled = new Set(preferences.enabledTools)
  return AGENT_TOOL_NAMES.filter((tool) => enabled.has(tool)
    && (preferences.executionMode === 'full-auto' || READ_ONLY_TOOLS.has(tool)))
}

function lastAssistantError(session: AgentSession): string | undefined {
  const message = [...session.messages].reverse().find((item) => item.role === 'assistant') as unknown as {
    stopReason?: string
    errorMessage?: string
  } | undefined
  return message?.stopReason === 'error'
    ? friendlyError(message.errorMessage || '模型响应失败')
    : undefined
}
