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
  type SessionInfo,
  type ToolCallEvent,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import type {
  AgentEvent,
  ChatMessage,
  ModelOption,
  SessionSnapshot,
  SessionSummary,
  ToolApprovalRequest
} from '../../shared/contracts'
import { ApprovalGate } from './approval-gate'
import { mapSdkEvent } from './event-mapper'
import { friendlyError } from './validation'
import type { SettingsStore } from './settings-store'
import { createPowerShellOperations } from './windows-shell'

const APPROVAL_TOOLS = new Set(['bash', 'edit', 'write'])

export class AgentRuntime {
  private modelRuntime?: ModelRuntime
  private session?: AgentSession
  private currentRun?: { sessionId: string; runId: string }
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
    const config = this.settings.get()
    const apiKey = this.settings.getApiKey()
    if (apiKey) await this.modelRuntime.setRuntimeApiKey(config.model.provider, apiKey)
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async updateModelKey(provider: string, apiKey?: string): Promise<void> {
    const runtime = this.requireModelRuntime()
    if (apiKey) await runtime.setRuntimeApiKey(provider, apiKey)
  }

  listModels(): ModelOption[] {
    return this.requireModelRuntime().getModels().map((model) => ({
      provider: model.provider,
      modelId: model.id,
      label: `${model.name} · ${model.provider}`
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
    const config = this.settings.get()
    const model = runtime.getModel(config.model.provider, config.model.modelId)
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
