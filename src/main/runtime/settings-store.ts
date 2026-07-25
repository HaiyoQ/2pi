import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AGENT_TOOL_NAMES } from '../../shared/contracts'
import type {
  ActiveModel,
  AgentPreferences,
  AgentToolName,
  AppSettings,
  ProviderDraft,
  ProviderHeader,
  ProviderProfile,
  ProviderProtocol
} from '../../shared/contracts'

interface StoredProvider {
  id: string
  type: 'builtin' | 'custom'
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderProfile['models']
  encryptedApiKey?: string
  headerNames: string[]
  encryptedHeaders?: string
}

interface SettingsFileV2 {
  version: 2
  providers: StoredProvider[]
  activeModel?: ActiveModel
  workspacePath: string
}

interface SettingsFileV3 {
  version: 3
  providers: StoredProvider[]
  activeModel?: ActiveModel
  workspacePath: string
  agent: AgentPreferences
  agentConfirmed: boolean
}

interface LegacySettingsFile {
  provider?: unknown
  modelId?: unknown
  workspacePath?: unknown
  encryptedApiKey?: unknown
}

const defaultAgentPreferences: AgentPreferences = {
  executionMode: 'full-auto',
  thinkingLevel: 'medium',
  autoRetry: true,
  enabledTools: [...AGENT_TOOL_NAMES]
}
const defaults: SettingsFileV3 = { version: 3, providers: [], workspacePath: '', agent: defaultAgentPreferences, agentConfirmed: true }

export interface SecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface ProviderSecrets {
  apiKey?: string
  headers: Record<string, string>
}

export class SettingsStore {
  private value: SettingsFileV3 = structuredClone(defaults)

  constructor(private readonly filePath: string, private readonly codec: SecretCodec) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      this.value = isV3(parsed)
        ? normalizeV3(parsed)
        : isV2(parsed)
          ? migrateV2(parsed)
          : migrateLegacy(parsed)
      if (!isV3(parsed)) await this.flush()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get(runtimeBusy = false): AppSettings {
    return {
      version: 3,
      providers: this.value.providers.map(toProfile),
      activeModel: this.value.activeModel ? { ...this.value.activeModel } : undefined,
      workspace: { path: this.value.workspacePath },
      agent: cloneAgentPreferences(this.value.agent),
      agentNeedsConfirmation: !this.value.agentConfirmed,
      runtimeBusy
    }
  }

  getProvider(providerId: string): ProviderProfile | undefined {
    const provider = this.value.providers.find((item) => item.id === providerId)
    return provider ? toProfile(provider) : undefined
  }

  getProviderSecrets(providerId: string): ProviderSecrets {
    const provider = this.value.providers.find((item) => item.id === providerId)
    if (!provider) return { headers: {} }
    let apiKey: string | undefined
    let headers: Record<string, string> = {}
    try {
      apiKey = provider.encryptedApiKey ? this.codec.decrypt(provider.encryptedApiKey) : undefined
    } catch {
      apiKey = undefined
    }
    try {
      headers = provider.encryptedHeaders
        ? JSON.parse(this.codec.decrypt(provider.encryptedHeaders)) as Record<string, string>
        : {}
    } catch {
      headers = {}
    }
    return {
      apiKey,
      headers
    }
  }

  async saveProvider(draft: ProviderDraft): Promise<ProviderProfile> {
    const id = draft.id ?? `custom-${randomUUID()}`
    const index = this.value.providers.findIndex((item) => item.id === id)
    const previous = index >= 0 ? this.value.providers[index] : undefined
    const previousHeaders = previous ? this.getProviderSecrets(id).headers : {}
    const headers = Object.fromEntries(draft.headers.map((header) => [header.name, header.value ?? previousHeaders[header.name] ?? '']))
    const provider: StoredProvider = {
      id,
      type: draft.type,
      name: draft.name,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      models: draft.models.map((model) => ({ ...model })),
      encryptedApiKey: draft.clearApiKey
        ? undefined
        : draft.apiKey
          ? this.codec.encrypt(draft.apiKey)
          : previous?.encryptedApiKey,
      headerNames: draft.headers.map((header) => header.name),
      encryptedHeaders: draft.headers.length ? this.codec.encrypt(JSON.stringify(headers)) : undefined
    }
    if (index >= 0) this.value.providers[index] = provider
    else this.value.providers.push(provider)
    if (this.value.activeModel?.providerId === id
      && !provider.models.some((model) => model.id === this.value.activeModel?.modelId)) {
      this.value.activeModel = undefined
    }
    await this.flush()
    return toProfile(provider)
  }

  async deleteProvider(providerId: string): Promise<AppSettings> {
    this.value.providers = this.value.providers.filter((item) => item.id !== providerId)
    if (this.value.activeModel?.providerId === providerId) this.value.activeModel = undefined
    await this.flush()
    return this.get()
  }

  async activateModel(model: ActiveModel): Promise<AppSettings> {
    const provider = this.value.providers.find((item) => item.id === model.providerId)
    if (!provider?.models.some((item) => item.id === model.modelId)) throw new Error('模型不属于该供应商')
    if (this.value.activeModel?.providerId === model.providerId && this.value.activeModel.modelId === model.modelId) return this.get()
    this.value.activeModel = { ...model }
    await this.flush()
    return this.get()
  }

  async saveAgentPreferences(preferences: AgentPreferences): Promise<AppSettings> {
    const next = normalizeAgentPreferences(preferences, defaultAgentPreferences)
    if (JSON.stringify(next) === JSON.stringify(this.value.agent) && this.value.agentConfirmed) return this.get()
    this.value.agent = next
    this.value.agentConfirmed = true
    await this.flush()
    return this.get()
  }

  async saveWorkspace(workspacePath: string): Promise<AppSettings> {
    if (this.value.workspacePath === workspacePath) return this.get()
    const previous = this.value.workspacePath
    this.value.workspacePath = workspacePath
    try {
      await this.flush()
    } catch (error) {
      this.value.workspacePath = previous
      throw error
    }
    return this.get()
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(this.value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
}

function toProfile(provider: StoredProvider): ProviderProfile {
  const headers: ProviderHeader[] = provider.headerNames.map((name) => ({ name, hasValue: true }))
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    models: provider.models.map((model) => ({ ...model })),
    hasApiKey: Boolean(provider.encryptedApiKey),
    headers
  }
}

function isV3(value: unknown): value is SettingsFileV3 {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === 3)
}

function isV2(value: unknown): value is SettingsFileV2 {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === 2)
}

function normalizeV3(value: SettingsFileV3): SettingsFileV3 {
  return {
    version: 3,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : '',
    activeModel: validActiveModel(value.activeModel) ? { ...value.activeModel } : undefined,
    providers: Array.isArray(value.providers) ? value.providers.filter(validStoredProvider).map((provider) => ({
      ...provider,
      models: provider.models.map(normalizeModel),
      headerNames: [...provider.headerNames]
    })) : [],
    agent: normalizeAgentPreferences(value.agent, defaultAgentPreferences),
    agentConfirmed: typeof value.agentConfirmed === 'boolean' ? value.agentConfirmed : true
  }
}

function migrateV2(value: SettingsFileV2): SettingsFileV3 {
  return {
    version: 3,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : '',
    activeModel: validActiveModel(value.activeModel) ? { ...value.activeModel } : undefined,
    providers: Array.isArray(value.providers) ? value.providers.filter(validStoredProvider).map((provider) => ({
      ...provider,
      models: provider.models.map(normalizeModel),
      headerNames: [...provider.headerNames]
    })) : [],
    agent: { ...structuredClone(defaultAgentPreferences), executionMode: 'read-only' },
    agentConfirmed: false
  }
}

function migrateLegacy(value: unknown): SettingsFileV3 {
  const legacy = value && typeof value === 'object' ? value as LegacySettingsFile : {}
  const providerId = typeof legacy.provider === 'string' && legacy.provider.trim() ? legacy.provider.trim() : undefined
  const modelId = typeof legacy.modelId === 'string' && legacy.modelId.trim() ? legacy.modelId.trim() : undefined
  const migratedAgent = { ...structuredClone(defaultAgentPreferences), executionMode: 'read-only' as const }
  if (!providerId || !modelId) return { ...structuredClone(defaults), workspacePath: typeof legacy.workspacePath === 'string' ? legacy.workspacePath : '', agent: migratedAgent, agentConfirmed: false }
  const provider: StoredProvider = {
    id: providerId,
    type: 'builtin',
    name: builtinName(providerId),
    protocol: builtinProtocol(providerId),
    baseUrl: builtinBaseUrl(providerId),
    models: [{ id: modelId, name: modelId, reasoning: false }],
    encryptedApiKey: typeof legacy.encryptedApiKey === 'string' ? legacy.encryptedApiKey : undefined,
    headerNames: []
  }
  return {
    version: 3,
    providers: [provider],
    activeModel: { providerId, modelId },
    workspacePath: typeof legacy.workspacePath === 'string' ? legacy.workspacePath : '',
    agent: migratedAgent,
    agentConfirmed: false
  }
}

function normalizeAgentPreferences(value: unknown, fallback: AgentPreferences): AgentPreferences {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentPreferences> : {}
  const enabledTools = Array.isArray(candidate.enabledTools)
    ? [...new Set(candidate.enabledTools.filter(isAgentToolName))]
    : [...fallback.enabledTools]
  return {
    executionMode: candidate.executionMode === 'read-only' || candidate.executionMode === 'full-auto'
      ? candidate.executionMode
      : fallback.executionMode,
    thinkingLevel: isThinkingLevel(candidate.thinkingLevel) ? candidate.thinkingLevel : fallback.thinkingLevel,
    autoRetry: typeof candidate.autoRetry === 'boolean' ? candidate.autoRetry : fallback.autoRetry,
    enabledTools
  }
}

function cloneAgentPreferences(value: AgentPreferences): AgentPreferences {
  return { ...value, enabledTools: [...value.enabledTools] }
}

function isAgentToolName(value: unknown): value is AgentToolName {
  return typeof value === 'string' && (AGENT_TOOL_NAMES as readonly string[]).includes(value)
}

function isThinkingLevel(value: unknown): value is AgentPreferences['thinkingLevel'] {
  return value === 'minimal' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh' || value === 'max'
}

function validActiveModel(value: unknown): value is ActiveModel {
  return Boolean(value && typeof value === 'object'
    && typeof (value as ActiveModel).providerId === 'string'
    && typeof (value as ActiveModel).modelId === 'string')
}

function validStoredProvider(value: unknown): value is StoredProvider {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StoredProvider>
  return typeof item.id === 'string' && (item.type === 'builtin' || item.type === 'custom')
    && typeof item.name === 'string' && isProtocol(item.protocol) && typeof item.baseUrl === 'string'
    && Array.isArray(item.models) && Array.isArray(item.headerNames)
}

function normalizeModel(model: ProviderProfile['models'][number]): ProviderProfile['models'][number] {
  const input = Array.isArray(model.input) && model.input.length
    ? [...new Set(model.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image'))]
    : ['text']
  return {
    ...model,
    input: (input.includes('text') ? input : ['text']) as ('text' | 'image')[],
    contextWindow: validLimit(model.contextWindow, 128_000),
    maxTokens: validLimit(model.maxTokens, 16_000),
    toolUse: model.toolUse !== false
  }
}

function validLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10_000_000 ? value : fallback
}

function isProtocol(value: unknown): value is ProviderProtocol {
  return value === 'openai-chat' || value === 'openai-responses'
    || value === 'anthropic-messages' || value === 'google-generative-ai'
}

function builtinName(id: string): string {
  return ({ openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' } as Record<string, string>)[id] ?? id
}

function builtinProtocol(id: string): ProviderProtocol {
  if (id === 'anthropic') return 'anthropic-messages'
  if (id === 'google') return 'google-generative-ai'
  return id === 'openai' ? 'openai-responses' : 'openai-chat'
}

function builtinBaseUrl(id: string): string {
  return ({
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    google: 'https://generativelanguage.googleapis.com/v1beta'
  } as Record<string, string>)[id] ?? ''
}
