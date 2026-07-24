export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface ToolApprovalRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  summary: string
  status: ApprovalStatus
}

export type AgentEvent =
  | { type: 'text-delta'; sessionId: string; runId: string; delta: string }
  | { type: 'tool-request'; sessionId: string; runId: string; request: ToolApprovalRequest }
  | { type: 'tool-progress'; sessionId: string; runId: string; toolCallId: string; toolName: string; summary: string }
  | { type: 'tool-complete'; sessionId: string; runId: string; toolCallId: string; toolName: string; isError: boolean; summary: string }
  | { type: 'run-complete'; sessionId: string; runId: string }
  | { type: 'run-failed'; sessionId: string; runId: string; message: string }

export interface SessionSummary {
  id: string
  name: string
  path: string
  workspacePath: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
}

export interface SessionSnapshot {
  summary: SessionSummary
  messages: ChatMessage[]
}

export type ProviderProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
export type ProviderProfileType = 'builtin' | 'custom'

export interface ProviderModel {
  id: string
  name: string
  reasoning: boolean
}

export interface ProviderHeader {
  name: string
  hasValue: boolean
}

export interface ProviderHeaderDraft {
  name: string
  value?: string
}

export interface ProviderProfile {
  id: string
  type: ProviderProfileType
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderModel[]
  hasApiKey: boolean
  headers: ProviderHeader[]
}

export interface ProviderDraft {
  id?: string
  type: ProviderProfileType
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderModel[]
  apiKey?: string
  clearApiKey?: boolean
  headers: ProviderHeaderDraft[]
}

export interface ProviderCatalogEntry {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderModel[]
}

export interface ActiveModel {
  providerId: string
  modelId: string
}

export interface ModelOption extends ActiveModel {
  providerName: string
  label: string
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  models: ProviderModel[]
}

export interface WorkspaceConfig {
  path: string
}

export interface AppSettings {
  version: 2
  providers: ProviderProfile[]
  activeModel?: ActiveModel
  workspace: WorkspaceConfig
  runtimeBusy: boolean
}

export interface AgentBridge {
  getSettings(): Promise<AppSettings>
  listProviderCatalog(): Promise<ProviderCatalogEntry[]>
  saveProvider(draft: ProviderDraft): Promise<AppSettings>
  deleteProvider(providerId: string): Promise<AppSettings>
  testProvider(draft: ProviderDraft): Promise<ConnectionTestResult>
  activateModel(model: ActiveModel): Promise<AppSettings>
  selectWorkspace(): Promise<WorkspaceConfig | null>
  listModels(): Promise<ModelOption[]>
  listSessions(): Promise<SessionSummary[]>
  createSession(): Promise<SessionSnapshot>
  openSession(sessionId: string): Promise<SessionSnapshot>
  sendPrompt(sessionId: string, text: string): Promise<{ runId: string }>
  decideApproval(requestId: string, decision: 'approved' | 'rejected'): Promise<ToolApprovalRequest>
  cancelRun(sessionId: string): Promise<void>
  onAgentEvent(listener: (event: AgentEvent) => void): () => void
}

export const IPC = {
  getSettings: 'settings:get',
  listProviderCatalog: 'providers:catalog',
  saveProvider: 'providers:save',
  deleteProvider: 'providers:delete',
  testProvider: 'providers:test',
  activateModel: 'models:activate',
  selectWorkspace: 'workspace:select',
  listModels: 'models:list',
  listSessions: 'sessions:list',
  createSession: 'sessions:create',
  openSession: 'sessions:open',
  sendPrompt: 'agent:prompt',
  decideApproval: 'agent:approve',
  cancelRun: 'agent:cancel',
  agentEvent: 'agent:event'
} as const
