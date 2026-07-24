import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ProviderDraft } from '../src/shared/contracts'
import { SettingsStore } from '../src/main/runtime/settings-store'

const codec = {
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

function draft(id: string, apiKey: string, headerValue: string): ProviderDraft {
  return {
    id, type: 'custom', name: id, protocol: 'openai-chat', baseUrl: `https://${id}.example/v1`,
    apiKey, headers: [{ name: 'X-Tenant', value: headerValue }],
    models: [{ id: `${id}-model`, name: `${id} model`, reasoning: false }]
  }
}

describe('SettingsStore v2', () => {
  it('隔离保存多个供应商密钥，磁盘与公开设置不出现明文', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-'))
    const path = join(dir, 'settings.json')
    const store = new SettingsStore(path, codec)
    await store.saveWorkspace('C:\\项目 目录')
    await store.saveProvider(draft('custom-a', 'secret-a', 'tenant-a'))
    await store.saveProvider(draft('custom-b', 'secret-b', 'tenant-b'))
    await store.activateModel({ providerId: 'custom-a', modelId: 'custom-a-model' })

    const disk = await readFile(path, 'utf8')
    expect(disk).not.toContain('secret-a')
    expect(disk).not.toContain('tenant-a')
    expect(JSON.stringify(store.get())).not.toContain('secret-a')

    const restored = new SettingsStore(path, codec)
    await restored.load()
    expect(restored.get().workspace.path).toBe('C:\\项目 目录')
    expect(restored.get().activeModel).toEqual({ providerId: 'custom-a', modelId: 'custom-a-model' })
    expect(restored.getProviderSecrets('custom-a')).toEqual({ apiKey: 'secret-a', headers: { 'X-Tenant': 'tenant-a' } })
    expect(restored.getProviderSecrets('custom-b').apiKey).toBe('secret-b')
  })

  it('迁移旧版单供应商设置且保留当前 OpenAI 密钥', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-migration-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({
      provider: 'openai', modelId: 'gpt-5-mini', workspacePath: 'D:\\repo', encryptedApiKey: codec.encrypt('legacy-key')
    }))
    const store = new SettingsStore(path, codec)
    await store.load()
    expect(store.get()).toMatchObject({
      version: 2,
      activeModel: { providerId: 'openai', modelId: 'gpt-5-mini' },
      workspace: { path: 'D:\\repo' }
    })
    expect(store.get().providers[0]).toMatchObject({ id: 'openai', type: 'builtin', hasApiKey: true })
    expect(store.getProviderSecrets('openai').apiKey).toBe('legacy-key')
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(2)
  })

  it('新安装为空供应商列表，重复激活同一模型保持幂等', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-empty-'))
    const store = new SettingsStore(join(dir, 'settings.json'), codec)
    await store.load()
    expect(store.get().providers).toEqual([])
    await store.saveProvider(draft('custom-a', 'key', 'header'))
    await store.activateModel({ providerId: 'custom-a', modelId: 'custom-a-model' })
    await store.activateModel({ providerId: 'custom-a', modelId: 'custom-a-model' })
    expect(store.get().activeModel).toEqual({ providerId: 'custom-a', modelId: 'custom-a-model' })
  })
})
