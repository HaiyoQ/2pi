import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppSettings, ModelConfig } from '../../shared/contracts'

interface SettingsFile {
  provider: string
  modelId: string
  workspacePath: string
  encryptedApiKey?: string
}

const defaults: SettingsFile = { provider: 'openai', modelId: 'gpt-5-mini', workspacePath: '' }

export interface SecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

export class SettingsStore {
  private value: SettingsFile = { ...defaults }

  constructor(private readonly filePath: string, private readonly codec: SecretCodec) {}

  async load(): Promise<void> {
    try {
      this.value = { ...defaults, ...JSON.parse(await readFile(this.filePath, 'utf8')) as SettingsFile }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get(): AppSettings {
    return {
      model: { provider: this.value.provider, modelId: this.value.modelId },
      workspace: { path: this.value.workspacePath },
      hasApiKey: Boolean(this.value.encryptedApiKey)
    }
  }

  getApiKey(): string | undefined {
    return this.value.encryptedApiKey ? this.codec.decrypt(this.value.encryptedApiKey) : undefined
  }

  async saveModel(config: ModelConfig): Promise<AppSettings> {
    this.value.provider = config.provider
    this.value.modelId = config.modelId
    if (config.apiKey) this.value.encryptedApiKey = this.codec.encrypt(config.apiKey)
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
