import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '../src/main/runtime/agent-runtime'
import { SettingsStore } from '../src/main/runtime/settings-store'

const codec = {
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

describe('AgentRuntime 供应商注册', () => {
  it('新增自定义供应商后立即列出模型，并可幂等切换和删除', async () => {
    const userData = await mkdtemp(join(tmpdir(), '2pi-runtime-provider-'))
    const settings = new SettingsStore(join(userData, 'settings.json'), codec)
    const runtime = new AgentRuntime(userData, settings)
    await runtime.initialize()

    await runtime.saveProvider({
      id: 'custom-local', type: 'custom', name: '本地模型', protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:12345/v1', headers: [],
      models: [{ id: 'local-model', name: 'Local Model', reasoning: false }]
    })
    expect(runtime.listModels()).toEqual([{
      providerId: 'custom-local', modelId: 'local-model', providerName: '本地模型', label: 'Local Model'
    }])

    await runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })
    await runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })
    expect(runtime.getSettings().activeModel).toEqual({ providerId: 'custom-local', modelId: 'local-model' })

    const internals = runtime as unknown as { currentRun?: { sessionId: string; runId: string } }
    internals.currentRun = { sessionId: 'session', runId: 'run' }
    await expect(runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })).rejects.toThrow('运行期间不能切换模型')
    await expect(runtime.deleteProvider('custom-local')).rejects.toThrow('运行期间不能删除供应商')
    internals.currentRun = undefined

    await runtime.deleteProvider('custom-local')
    expect(runtime.getSettings().providers).toEqual([])
    expect(runtime.getSettings().activeModel).toBeUndefined()
  })
})
