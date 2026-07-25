export const AGENT_TOOL_NAMES = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'] as const
export type AgentToolName = typeof AGENT_TOOL_NAMES[number]
export type ExecutionMode = 'read-only' | 'full-auto'
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentPreferences {
  executionMode: ExecutionMode
  thinkingLevel: ThinkingLevel
  autoRetry: boolean
  enabledTools: AgentToolName[]
}

export interface RunContract extends AgentPreferences {
  effectiveTools: AgentToolName[]
  providerId: string
  modelId: string
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface ContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export type QueuedMessageMode = 'steer' | 'follow-up'

export interface QueuedMessage {
  id: string
  mode: QueuedMessageMode
  text: string
  createdAt: string
}

export interface QueueSnapshot {
  items: QueuedMessage[]
}

export interface CompactionSummary {
  tokensBefore: number
  estimatedTokensAfter: number | null
  context?: ContextUsage
}

export type AgentResourceKind = 'skill' | 'prompt' | 'extension' | 'context'
export type AgentResourceScope = 'user' | 'project'

export interface AgentResourceItem {
  id: string
  kind: AgentResourceKind
  name: string
  description?: string
  path: string
  scope: AgentResourceScope
}

export interface AgentResourceDiagnostic {
  id: string
  severity: 'warning' | 'error' | 'collision'
  message: string
  path?: string
}

export interface ProjectResourceTrust {
  required: boolean
  decision: 'trusted' | 'blocked' | 'unset'
  savedPath?: string
}

export interface AgentResourcesSnapshot {
  workspacePath?: string
  userResourcePath: string
  projectResourcePath?: string
  trust: ProjectResourceTrust
  resources: AgentResourceItem[]
  diagnostics: AgentResourceDiagnostic[]
}

export interface TimelineMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images: PromptImage[]
  timestamp: string
}

export interface PromptImage {
  data: string
  mimeType: ImageMimeType
}

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface PromptInput {
  text: string
  images: PromptImage[]
}

export type TimelineActivity =
  | { id: string; type: 'thinking'; status: 'running' | 'complete'; timestamp: string; durationMs?: number }
  | { id: string; type: 'tool'; toolCallId: string; toolName: string; summary: string; targetPath?: string; status: 'running' | 'complete' | 'error'; timestamp: string }
  | { id: string; type: 'retry'; attempt: number; maxAttempts: number; delayMs: number; message: string; status: 'waiting' | 'running' | 'succeeded' | 'failed'; timestamp: string }

export interface TimelineTurn {
  id: string
  user: TimelineMessage
  assistant?: TimelineMessage
  activities: TimelineActivity[]
  state: 'running' | 'complete' | 'failed' | 'cancelled'
  error?: string
  usage: TokenUsage
}

export type AgentEvent =
  | { type: 'text-delta'; sessionId: string; runId: string; delta: string }
  | { type: 'thinking-status'; sessionId: string; runId: string; status: 'running' | 'complete'; timestamp: string }
  | { type: 'tool-progress'; sessionId: string; runId: string; toolCallId: string; toolName: string; summary: string; targetPath?: string }
  | { type: 'tool-complete'; sessionId: string; runId: string; toolCallId: string; toolName: string; isError: boolean; summary: string }
  | { type: 'retry-status'; sessionId: string; runId: string; attempt: number; maxAttempts: number; delayMs: number; message: string; status: 'waiting' | 'running' | 'succeeded' | 'failed'; timestamp: string }
  | { type: 'usage-delta'; sessionId: string; runId: string; usage: TokenUsage; context?: ContextUsage }
  | { type: 'queue-updated'; sessionId: string; runId: string; queue: QueueSnapshot }
  | { type: 'queued-message-start'; sessionId: string; runId: string; item: QueuedMessage }
  | { type: 'run-complete'; sessionId: string; runId: string; context?: ContextUsage }
  | { type: 'run-failed'; sessionId: string; runId: string; message: string }
  | { type: 'run-cancelled'; sessionId: string; runId: string }

export interface SessionSummary {
  id: string
  name: string
  path: string
  workspacePath: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface SessionSnapshot {
  summary: SessionSummary
  turns: TimelineTurn[]
  context?: ContextUsage
}

export type SessionTreeNodeKind = 'user' | 'assistant' | 'tool' | 'compaction' | 'branch-summary'

export interface SessionTreeNode {
  id: string
  parentId?: string
  depth: number
  kind: SessionTreeNodeKind
  title: string
  preview: string
  timestamp: string
  active: boolean
  branchable: boolean
}

export interface SessionTreeSnapshot {
  sessionId: string
  leafId?: string
  nodes: SessionTreeNode[]
}

export interface BranchSessionResult {
  snapshot: SessionSnapshot
  tree: SessionTreeSnapshot
  summary?: string
}

export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'
export type GitDiffSectionKind = 'staged' | 'working' | 'untracked'

export interface GitDiffSection {
  kind: GitDiffSectionKind
  diff: string
  truncated: boolean
}

export interface GitChangedFile {
  path: string
  oldPath?: string
  status: GitChangeStatus
  staged: boolean
  unstaged: boolean
  binary: boolean
  additions: number
  deletions: number
  sections: GitDiffSection[]
}

export interface GitDiffSnapshot {
  workspacePath?: string
  state: 'ready' | 'no-workspace' | 'not-git' | 'git-unavailable' | 'error'
  message: string
  files: GitChangedFile[]
  truncated: boolean
  generatedAt: string
}

export type ProviderProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
export type ProviderProfileType = 'builtin' | 'custom'

export interface ProviderModel {
  id: string
  name: string
  reasoning: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  toolUse?: boolean
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

export type ProviderConnectionDraft = Pick<
  ProviderDraft,
  'id' | 'protocol' | 'baseUrl' | 'apiKey' | 'clearApiKey' | 'headers'
>

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
  reasoning: boolean
  input: ('text' | 'image')[]
  contextWindow: number
  maxTokens: number
  toolUse: boolean
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  models: ProviderModel[]
  failedField?: 'baseUrl' | 'apiKey'
}

export interface WorkspaceConfig {
  path: string
}

export interface AppSettings {
  version: 3
  providers: ProviderProfile[]
  activeModel?: ActiveModel
  workspace: WorkspaceConfig
  agent: AgentPreferences
  agentNeedsConfirmation: boolean
  runtimeBusy: boolean
}

export interface AgentBridge {
  getSettings(): Promise<AppSettings>
  listProviderCatalog(): Promise<ProviderCatalogEntry[]>
  saveProvider(draft: ProviderDraft): Promise<AppSettings>
  deleteProvider(providerId: string): Promise<AppSettings>
  testProvider(draft: ProviderConnectionDraft): Promise<ConnectionTestResult>
  activateModel(model: ActiveModel): Promise<AppSettings>
  saveAgentPreferences(preferences: AgentPreferences): Promise<AppSettings>
  selectWorkspace(): Promise<WorkspaceConfig | null>
  listModels(): Promise<ModelOption[]>
  listSessions(): Promise<SessionSummary[]>
  searchSessions(query: string): Promise<SessionSummary[]>
  createSession(): Promise<SessionSnapshot>
  openSession(sessionId: string): Promise<SessionSnapshot>
  renameSession(sessionId: string, name: string): Promise<SessionSummary>
  getSessionTree(sessionId: string): Promise<SessionTreeSnapshot>
  branchSession(sessionId: string, requestId: string, entryId: string): Promise<BranchSessionResult>
  getGitDiff(): Promise<GitDiffSnapshot>
  sendPrompt(sessionId: string, input: PromptInput): Promise<{ runId: string; contract: RunContract }>
  queuePrompt(sessionId: string, requestId: string, input: PromptInput, mode: QueuedMessageMode): Promise<QueueSnapshot>
  removeQueuedPrompt(sessionId: string, messageId: string): Promise<QueueSnapshot>
  compactSession(sessionId: string): Promise<CompactionSummary>
  listAgentResources(): Promise<AgentResourcesSnapshot>
  reloadAgentResources(): Promise<AgentResourcesSnapshot>
  setProjectResourceTrust(trusted: boolean): Promise<AgentResourcesSnapshot>
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
  saveAgentPreferences: 'agent-settings:save',
  selectWorkspace: 'workspace:select',
  listModels: 'models:list',
  listSessions: 'sessions:list',
  searchSessions: 'sessions:search',
  createSession: 'sessions:create',
  openSession: 'sessions:open',
  renameSession: 'sessions:rename',
  getSessionTree: 'sessions:tree',
  branchSession: 'sessions:branch',
  getGitDiff: 'git:diff',
  sendPrompt: 'agent:prompt',
  queuePrompt: 'agent:queue',
  removeQueuedPrompt: 'agent:queue-remove',
  compactSession: 'agent:compact',
  listAgentResources: 'agent-resources:list',
  reloadAgentResources: 'agent-resources:reload',
  setProjectResourceTrust: 'agent-resources:trust',
  cancelRun: 'agent:cancel',
  agentEvent: 'agent:event'
} as const
