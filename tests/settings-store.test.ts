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

describe('SettingsStore v3', () => {
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
      version: 3,
      activeModel: { providerId: 'openai', modelId: 'gpt-5-mini' },
      workspace: { path: 'D:\\repo' },
      agent: { executionMode: 'read-only' },
      agentNeedsConfirmation: true
    })
    expect(store.get().providers[0]).toMatchObject({ id: 'openai', type: 'builtin', hasApiKey: true })
    expect(store.getProviderSecrets('openai').apiKey).toBe('legacy-key')
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(3)
  })

  it('将 v2 配置安全迁移为只读并保留供应商秘密', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-v2-migration-'))
    const path = join(dir, 'settings.json')
    await writeFile(path, JSON.stringify({
      version: 2,
      workspacePath: 'E:\\repo',
      providers: [{
        id: 'custom-a', type: 'custom', name: 'A', protocol: 'openai-chat', baseUrl: 'https://a.example/v1',
        models: [{ id: 'a-model', name: 'A model', reasoning: true }],
        encryptedApiKey: codec.encrypt('secret-a'), headerNames: []
      }],
      activeModel: { providerId: 'custom-a', modelId: 'a-model' }
    }))

    const store = new SettingsStore(path, codec)
    await store.load()

    expect(store.get()).toMatchObject({
      version: 3,
      workspace: { path: 'E:\\repo' },
      activeModel: { providerId: 'custom-a', modelId: 'a-model' },
      agent: { executionMode: 'read-only', thinkingLevel: 'medium', autoRetry: true },
      agentNeedsConfirmation: true
    })
    expect(store.getProviderSecrets('custom-a').apiKey).toBe('secret-a')
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(3)
  })

  it('新安装默认全自动，重复设置保持幂等', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-empty-'))
    const store = new SettingsStore(join(dir, 'settings.json'), codec)
    await store.load()
    expect(store.get().providers).toEqual([])
    expect(store.get().agent).toEqual({
      executionMode: 'full-auto', thinkingLevel: 'medium', autoRetry: true,
      enabledTools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write']
    })
    await store.saveProvider(draft('custom-a', 'key', 'header'))
    await store.activateModel({ providerId: 'custom-a', modelId: 'custom-a-model' })
    await store.activateModel({ providerId: 'custom-a', modelId: 'custom-a-model' })
    await store.saveAgentPreferences({ executionMode: 'read-only', thinkingLevel: 'high', autoRetry: false, enabledTools: ['read', 'grep'] })
    await store.saveAgentPreferences({ executionMode: 'read-only', thinkingLevel: 'high', autoRetry: false, enabledTools: ['read', 'grep'] })
    expect(store.get().activeModel).toEqual({ providerId: 'custom-a', modelId: 'custom-a-model' })
    expect(store.get().agent).toEqual({ executionMode: 'read-only', thinkingLevel: 'high', autoRetry: false, enabledTools: ['read', 'grep'] })
    expect(store.get().agentNeedsConfirmation).toBe(false)
  })

  it('工作目录写盘失败时恢复内存中的原值', async () => {
    const dir = await mkdtemp(join(tmpdir(), '2pi-settings-workspace-failure-'))
    const store = new SettingsStore(join(dir, 'settings.json'), codec)
    await store.saveWorkspace('C:\\current')
    const internals = store as unknown as { flush: () => Promise<void> }
    internals.flush = async () => { throw new Error('写盘失败') }

    await expect(store.saveWorkspace('D:\\next')).rejects.toThrow('写盘失败')
    expect(store.get().workspace.path).toBe('C:\\current')
  })
})
