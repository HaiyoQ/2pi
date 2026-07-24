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
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type ExtensionFactory,
  type ProviderConfig,
  type SessionInfo,
  type ToolCallEvent,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import type {
  AgentEvent,
  ActiveModel,
  AppSettings,
  ChatMessage,
  ConnectionTestResult,
  ModelOption,
  ProviderCatalogEntry,
  ProviderDraft,
  ProviderProfile,
  ProviderProtocol,
  SessionSnapshot,
  SessionSummary,
  ToolApprovalRequest
} from '../../shared/contracts'
import { ApprovalGate } from './approval-gate'
import { mapSdkEvent } from './event-mapper'
import { friendlyError } from './validation'
import type { SettingsStore } from './settings-store'
import { testProviderConnection } from './provider-discovery'
import { createPowerShellOperations } from './windows-shell'

const APPROVAL_TOOLS = new Set(['bash', 'edit', 'write'])

export class AgentRuntime {
  private modelRuntime?: ModelRuntime
  private session?: AgentSession
  private currentRun?: { sessionId: string; runId: string }
  private catalog: ProviderCatalogEntry[] = []
  private unsubscribe?: () => void
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly gate = new ApprovalGate((request) => this.emitApproval(request))

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

  async testProvider(draft: ProviderDraft): Promise<ConnectionTestResult> {
    const existing = draft.id ? this.settings.getProviderSecrets(draft.id) : { headers: {} }
    const headers = Object.fromEntries(draft.headers.map((item) => [item.name, item.value ?? existing.headers[item.name] ?? '']))
    return testProviderConnection({
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey ?? existing.apiKey,
      headers
    })
  }

  async activateModel(model: ActiveModel): Promise<AppSettings> {
    this.requireIdle('运行期间不能切换模型')
    await this.settings.activateModel(model)
    await this.applySessionModel(model)
    return this.getSettings()
  }

  listModels(): ModelOption[] {
    const runtime = this.requireModelRuntime()
    return this.settings.get().providers.flatMap((provider) => provider.models.flatMap((configured) => {
      const model = runtime.getModel(provider.id, configured.id)
      return model ? [{ providerId: provider.id, modelId: model.id, providerName: provider.name, label: model.name }] : []
    }))
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessions = await SessionManager.listAll(this.sessionDir)
    return sessions.map(toSummary)
  }

  async createSession(): Promise<SessionSnapshot> {
    const workspace = this.requireWorkspace()
    const manager = SessionManager.create(workspace, this.sessionDir)
    await this.bindSession(manager)
    return this.snapshot()
  }

  async openSession(sessionId: string): Promise<SessionSnapshot> {
    const sessions = await SessionManager.listAll(this.sessionDir)
    const found = sessions.find((item) => item.id === sessionId)
    if (!found) throw new Error('会话不存在')
    const workspace = this.settings.get().workspace.path || found.cwd
    await this.bindSession(SessionManager.open(found.path, this.sessionDir, workspace))
    return this.snapshot()
  }

  async sendPrompt(sessionId: string, text: string): Promise<{ runId: string }> {
    if (!this.session || this.session.sessionId !== sessionId) throw new Error('请先打开会话')
    if (this.currentRun || this.session.isStreaming) throw new Error('当前任务仍在运行')
    const runId = randomUUID()
    this.currentRun = { sessionId, runId }
    void this.session.prompt(text).catch((error) => {
      this.emit({ type: 'run-failed', sessionId, runId, message: friendlyError(error) })
      this.currentRun = undefined
    })
    return { runId }
  }

  decideApproval(requestId: string, decision: 'approved' | 'rejected'): ToolApprovalRequest {
    return this.gate.decide(requestId, decision)
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.session || this.session.sessionId !== sessionId) return
    this.gate.cancelSession(sessionId)
    await this.session.abort()
    this.currentRun = undefined
  }

  private async bindSession(manager: SessionManager): Promise<void> {
    const runtime = this.requireModelRuntime()
    const active = this.settings.get().activeModel
    if (!active) throw new Error('请先在模型设置中选择一个模型')
    const model = runtime.getModel(active.providerId, active.modelId)
    if (!model) throw new Error('找不到所选模型，请在设置中重新选择')

    this.unsubscribe?.()
    this.session?.dispose()
    this.currentRun = undefined

    const loader = new DefaultResourceLoader({
      cwd: manager.getCwd(),
      agentDir: this.agentDir,
      extensionFactories: [{ name: 'desktop-approval', hidden: true, factory: this.approvalExtension(manager.getSessionId()) }],
      appendSystemPrompt: [
        '当前运行环境是 Windows 桌面应用。终端命令请使用 PowerShell 语法，并优先使用对中文及空格路径安全的写法。'
      ]
    })
    await loader.reload()
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
      noTools: 'builtin',
      customTools,
      tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write']
    })
    this.session = result.session
    this.unsubscribe = result.session.subscribe((sdkEvent) => {
      const run = this.currentRun
      if (!run) return
      const event = mapSdkEvent(sdkEvent, run.sessionId, run.runId)
      if (event) this.emit(event)
      if (event?.type === 'run-complete' || event?.type === 'run-failed') this.currentRun = undefined
    })
  }

  private approvalExtension(sessionId: string): ExtensionFactory {
    return (pi) => {
      pi.on('tool_call', async (event) => {
        if (!APPROVAL_TOOLS.has(event.toolName)) return
        const approved = await this.gate.request({
          sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          summary: summarizeTool(event),
        })
        if (!approved) return { block: true, reason: '用户拒绝了这次工具调用。请根据现状继续处理，不要重复执行相同操作。' }
      })
    }
  }

  private snapshot(): SessionSnapshot {
    if (!this.session) throw new Error('会话尚未打开')
    const manager = this.session.sessionManager
    const header = manager.getHeader()
    const now = header?.timestamp ?? new Date().toISOString()
    const messages = manager.getEntries().flatMap((entry): ChatMessage[] => {
      if (entry.type !== 'message') return []
      const message = entry.message as { role?: string; content?: unknown; timestamp?: number | string }
      if (message.role !== 'user' && message.role !== 'assistant') return []
      const text = contentText(message.content)
      if (!text) return []
      return [{ id: entry.id, role: message.role, text, timestamp: normalizeTimestamp(message.timestamp, entry.timestamp) }]
    })
    const path = manager.getSessionFile() ?? ''
    return {
      summary: {
        id: manager.getSessionId(),
        name: manager.getSessionName() || messages.find((item) => item.role === 'user')?.text.slice(0, 28) || '新会话',
        path,
        workspacePath: manager.getCwd(),
        createdAt: now,
        updatedAt: messages.at(-1)?.timestamp ?? now,
        messageCount: messages.length
      },
      messages
    }
  }

  private emitApproval(request: ToolApprovalRequest): void {
    const run = this.currentRun
    if (run) this.emit({ type: 'tool-request', sessionId: run.sessionId, runId: run.runId, request })
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
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_000
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
    return Boolean(this.currentRun || this.session?.isStreaming)
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
  }
}

function toSdkApi(protocol: ProviderProtocol): 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai' {
  return protocol === 'openai-chat' ? 'openai-completions' : protocol
}

function buildCatalog(runtime: ModelRuntime): ProviderCatalogEntry[] {
  return runtime.getProviders().flatMap((provider) => {
    if (!provider.auth.apiKey?.login) return []
    const models = provider.getModels()
    const protocol = models[0] ? fromSdkApi(models[0].api) : undefined
    if (!protocol || !provider.baseUrl || models.length === 0) return []
    return [{
      id: provider.id,
      name: provider.name,
      protocol,
      baseUrl: provider.baseUrl,
      models: models.map((model) => ({ id: model.id, name: model.name, reasoning: model.reasoning }))
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

function summarizeTool(event: ToolCallEvent): string {
  const input = event.input as Record<string, unknown>
  if (event.toolName === 'bash') return `运行命令：${String(input.command ?? '').slice(0, 320)}`
  const target = String(input.path ?? input.file_path ?? '目标文件')
  return event.toolName === 'write' ? `写入文件：${target}` : `编辑文件：${target}`
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return [part.text]
    return []
  }).join('')
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'number') return new Date(value).toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  return fallback
}
