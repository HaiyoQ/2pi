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

export interface ModelConfig {
  provider: string
  modelId: string
  apiKey?: string
}

export interface ModelOption {
  provider: string
  modelId: string
  label: string
}

export interface WorkspaceConfig {
  path: string
}

export interface AppSettings {
  model: Omit<ModelConfig, 'apiKey'>
  workspace: WorkspaceConfig
  hasApiKey: boolean
}

export interface AgentBridge {
  getSettings(): Promise<AppSettings>
  saveSettings(config: ModelConfig): Promise<AppSettings>
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
  saveSettings: 'settings:save',
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
