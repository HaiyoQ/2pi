import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ActiveModel,
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

interface LegacySettingsFile {
  provider?: unknown
  modelId?: unknown
  workspacePath?: unknown
  encryptedApiKey?: unknown
}

const defaults: SettingsFileV2 = { version: 2, providers: [], workspacePath: '' }

export interface SecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface ProviderSecrets {
  apiKey?: string
  headers: Record<string, string>
}

export class SettingsStore {
  private value: SettingsFileV2 = structuredClone(defaults)

  constructor(private readonly filePath: string, private readonly codec: SecretCodec) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      this.value = isV2(parsed) ? normalizeV2(parsed) : migrateLegacy(parsed)
      if (!isV2(parsed)) await this.flush()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get(runtimeBusy = false): AppSettings {
    return {
      version: 2,
      providers: this.value.providers.map(toProfile),
      activeModel: this.value.activeModel ? { ...this.value.activeModel } : undefined,
      workspace: { path: this.value.workspacePath },
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
    return {
      apiKey: provider.encryptedApiKey ? this.codec.decrypt(provider.encryptedApiKey) : undefined,
      headers: provider.encryptedHeaders
        ? JSON.parse(this.codec.decrypt(provider.encryptedHeaders)) as Record<string, string>
        : {}
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

  async saveWorkspace(workspacePath: string): Promise<AppSettings> {
    this.value.workspacePath = workspacePath
    await this.flush()
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

function isV2(value: unknown): value is SettingsFileV2 {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === 2)
}

function normalizeV2(value: SettingsFileV2): SettingsFileV2 {
  return {
    version: 2,
    workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : '',
    activeModel: validActiveModel(value.activeModel) ? { ...value.activeModel } : undefined,
    providers: Array.isArray(value.providers) ? value.providers.filter(validStoredProvider).map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({ ...model })),
      headerNames: [...provider.headerNames]
    })) : []
  }
}

function migrateLegacy(value: unknown): SettingsFileV2 {
  const legacy = value && typeof value === 'object' ? value as LegacySettingsFile : {}
  const providerId = typeof legacy.provider === 'string' && legacy.provider.trim() ? legacy.provider.trim() : undefined
  const modelId = typeof legacy.modelId === 'string' && legacy.modelId.trim() ? legacy.modelId.trim() : undefined
  if (!providerId || !modelId) return { ...defaults, workspacePath: typeof legacy.workspacePath === 'string' ? legacy.workspacePath : '' }
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
    version: 2,
    providers: [provider],
    activeModel: { providerId, modelId },
    workspacePath: typeof legacy.workspacePath === 'string' ? legacy.workspacePath : ''
  }
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
