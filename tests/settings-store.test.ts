import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/runtime/settings-store'

const codec = {
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

describe('SettingsStore', () => {
  it('保存并恢复设置，磁盘中不出现 API Key 明文', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-'))
    const path = join(dir, 'settings.json')
    const store = new SettingsStore(path, codec)
    await store.saveWorkspace('C:\\项目 目录')
    await store.saveModel({ provider: 'openai', modelId: 'gpt-5-mini', apiKey: 'top-secret' })
    expect(await readFile(path, 'utf8')).not.toContain('top-secret')

    const restored = new SettingsStore(path, codec)
    await restored.load()
    expect(restored.get().workspace.path).toBe('C:\\项目 目录')
    expect(restored.getApiKey()).toBe('top-secret')
  })
})
