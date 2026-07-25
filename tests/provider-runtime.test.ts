import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { AgentRuntime, resolveEffectiveTools } from '../src/main/runtime/agent-runtime'
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

    const catalog = runtime.listProviderCatalog()
    expect(catalog.length).toBeGreaterThan(0)
    expect(catalog.every((provider) => provider.models.length === 0)).toBe(true)

    await runtime.saveProvider({
      id: 'custom-local', type: 'custom', name: '本地模型', protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:12345/v1', headers: [],
      models: [{ id: 'local-model', name: 'Local Model', reasoning: false }]
    })
    expect(runtime.listModels()).toEqual([{
      providerId: 'custom-local', modelId: 'local-model', providerName: '本地模型', label: 'Local Model', reasoning: false,
      input: ['text'], contextWindow: 128_000, maxTokens: 16_000, toolUse: true
    }])

    await runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })
    await runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })
    expect(runtime.getSettings().activeModel).toEqual({ providerId: 'custom-local', modelId: 'local-model' })

    const internals = runtime as unknown as { currentRun?: { sessionId: string; runId: string } }
    internals.currentRun = { sessionId: 'session', runId: 'run' }
    await expect(runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })).rejects.toThrow('运行期间不能切换模型')
    await expect(runtime.deleteProvider('custom-local')).rejects.toThrow('运行期间不能删除供应商')
    await expect(runtime.saveWorkspace('D:\\other')).rejects.toThrow('运行期间不能切换工作目录')
    internals.currentRun = undefined

    await runtime.deleteProvider('custom-local')
    expect(runtime.getSettings().providers).toEqual([])
    expect(runtime.getSettings().activeModel).toBeUndefined()
  })

  it('只读档从主进程允许列表中移除所有可变更工具', () => {
    const enabledTools = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'] as const
    expect(resolveEffectiveTools({ executionMode: 'read-only', thinkingLevel: 'medium', autoRetry: true, enabledTools: [...enabledTools] }))
      .toEqual(['read', 'grep', 'find', 'ls'])
    expect(resolveEffectiveTools({ executionMode: 'full-auto', thinkingLevel: 'medium', autoRetry: true, enabledTools: ['read', 'bash', 'write'] }))
      .toEqual(['read', 'bash', 'write'])
    expect(resolveEffectiveTools({ executionMode: 'full-auto', thinkingLevel: 'medium', autoRetry: true, enabledTools: ['read', 'bash', 'write'] }, false))
      .toEqual([])
  })

  it('打开其他项目的历史会话后才切换并保存工作目录', async () => {
    const userData = await mkdtemp(join(tmpdir(), '2pi-runtime-session-'))
    const currentWorkspace = join(userData, 'current-project')
    const historicalWorkspace = join(userData, 'historical-project')
    await Promise.all([mkdir(currentWorkspace), mkdir(historicalWorkspace), mkdir(join(userData, 'sessions'))])
    const manager = SessionManager.create(historicalWorkspace, join(userData, 'sessions'))
    persistSession(manager, '继续历史任务')

    const settings = new SettingsStore(join(userData, 'settings.json'), codec)
    await settings.saveWorkspace(currentWorkspace)
    const runtime = new AgentRuntime(userData, settings)
    await runtime.initialize()
    await runtime.saveProvider({
      id: 'custom-local', type: 'custom', name: '本地模型', protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:12345/v1', headers: [],
      models: [{ id: 'local-model', name: 'Local Model', reasoning: false }]
    })
    await runtime.activateModel({ providerId: 'custom-local', modelId: 'local-model' })

    const snapshot = await runtime.openSession(manager.getSessionId())

    expect(snapshot.summary.workspacePath).toBe(historicalWorkspace)
    expect(settings.get().workspace.path).toBe(historicalWorkspace)
  })

  it('历史会话绑定失败时保留当前工作目录', async () => {
    const userData = await mkdtemp(join(tmpdir(), '2pi-runtime-session-failure-'))
    const currentWorkspace = join(userData, 'current-project')
    const historicalWorkspace = join(userData, 'historical-project')
    await Promise.all([mkdir(currentWorkspace), mkdir(historicalWorkspace), mkdir(join(userData, 'sessions'))])
    const manager = SessionManager.create(historicalWorkspace, join(userData, 'sessions'))
    persistSession(manager, '不应切换目录')

    const settings = new SettingsStore(join(userData, 'settings.json'), codec)
    await settings.saveWorkspace(currentWorkspace)
    const runtime = new AgentRuntime(userData, settings)
    await runtime.initialize()

    await expect(runtime.openSession(manager.getSessionId())).rejects.toThrow('请先在模型设置中选择一个模型')
    expect(settings.get().workspace.path).toBe(currentWorkspace)
  })
})

function persistSession(manager: SessionManager, userMessage: string): void {
  manager.appendMessage({ role: 'user', content: userMessage, timestamp: Date.now() })
  manager.appendMessage({
    role: 'assistant', content: [{ type: 'text', text: '已记录' }],
    api: 'openai-chat', provider: 'custom-local', model: 'local-model',
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop', timestamp: Date.now()
  } as never)
}
