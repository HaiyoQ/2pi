/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentBridge, AgentEvent, AppSettings, RunContract, SessionSnapshot } from '../../../shared/contracts'
import { useAgentStore } from './agent'

const settings: AppSettings = {
  version: 3,
  providers: [],
  workspace: { path: 'C:\\work\\two-pi' },
  agent: {
    executionMode: 'full-auto', thinkingLevel: 'medium', autoRetry: true,
    enabledTools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write']
  },
  agentNeedsConfirmation: false,
  runtimeBusy: false
}

const contract: RunContract = {
  ...settings.agent,
  enabledTools: [...settings.agent.enabledTools],
  effectiveTools: [...settings.agent.enabledTools],
  providerId: 'custom',
  modelId: 'model'
}

const snapshot: SessionSnapshot = {
  summary: {
    id: 'session-1',
    name: '修复设置保存顺序',
    path: 'session-1.jsonl',
    workspacePath: settings.workspace.path,
    createdAt: '2026-07-25T05:00:00.000Z',
    updatedAt: '2026-07-25T05:00:00.000Z',
    messageCount: 0
  },
  turns: [],
  context: { tokens: 20, contextWindow: 100, percent: 20 }
}

describe('renderer agent store', () => {
  let listener: ((event: AgentEvent) => void) | undefined
  let bridge: AgentBridge

  beforeEach(() => {
    setActivePinia(createPinia())
    listener = undefined
    bridge = {
      getSettings: vi.fn().mockResolvedValue(structuredClone(settings)),
      listProviderCatalog: vi.fn().mockResolvedValue([]),
      saveProvider: vi.fn(),
      deleteProvider: vi.fn(),
      testProvider: vi.fn(),
      activateModel: vi.fn(),
      saveAgentPreferences: vi.fn().mockImplementation(async (preferences) => ({ ...structuredClone(settings), agent: preferences })),
      selectWorkspace: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      listSessions: vi.fn().mockResolvedValue([snapshot.summary]),
      searchSessions: vi.fn().mockResolvedValue([snapshot.summary]),
      createSession: vi.fn().mockResolvedValue(structuredClone(snapshot)),
      openSession: vi.fn().mockResolvedValue(structuredClone(snapshot)),
      renameSession: vi.fn().mockImplementation(async (_id, name) => ({ ...snapshot.summary, name })),
      getSessionTree: vi.fn().mockResolvedValue({ sessionId: snapshot.summary.id, nodes: [] }),
      branchSession: vi.fn().mockResolvedValue({ snapshot: structuredClone(snapshot), tree: { sessionId: snapshot.summary.id, nodes: [] } }),
      getGitDiff: vi.fn().mockResolvedValue({ workspacePath: settings.workspace.path, state: 'ready', message: '没有改动', files: [], truncated: false, generatedAt: '2026-07-25T05:00:00.000Z' }),
      sendPrompt: vi.fn().mockResolvedValue({ runId: 'run-1', contract }),
      queuePrompt: vi.fn().mockResolvedValue({ items: [] }),
      removeQueuedPrompt: vi.fn().mockResolvedValue({ items: [] }),
      compactSession: vi.fn().mockResolvedValue({ tokensBefore: 20, estimatedTokensAfter: 8, context: { tokens: 8, contextWindow: 100, percent: 8 } }),
      listAgentResources: vi.fn(),
      reloadAgentResources: vi.fn(),
      setProjectResourceTrust: vi.fn(),
      cancelRun: vi.fn().mockResolvedValue(undefined),
      onAgentEvent: vi.fn((callback) => {
        listener = callback
        return () => undefined
      })
    }
    Object.defineProperty(window, 'agent', { configurable: true, value: bridge })
  })

  it('initializes once and restores context through the typed bridge', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.initialize()
    await store.openSession(snapshot.summary.id)

    expect(store.initialized).toBe(true)
    expect(store.workspaceName).toBe('two-pi')
    expect(store.contextUsage).toEqual(snapshot.context)
    expect(bridge.getSettings).toHaveBeenCalledTimes(1)
    expect(bridge.onAgentEvent).toHaveBeenCalledTimes(1)
  })

  it('switches the visible workspace when opening a session from another project', async () => {
    const other = structuredClone(snapshot)
    other.summary.workspacePath = 'C:\\work\\another-project'
    bridge.openSession = vi.fn().mockResolvedValue(other)
    const store = useAgentStore()
    await store.initialize()

    await store.openSession(snapshot.summary.id)

    expect(store.settings?.workspace.path).toBe('C:\\work\\another-project')
    expect(store.workspaceName).toBe('another-project')
  })

  it('keeps thinking, tools, retries and usage inside the active turn', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    await store.send('运行测试')

    listener?.({ type: 'thinking-status', sessionId: snapshot.summary.id, runId: 'run-1', status: 'running', timestamp: '2026-07-25T05:00:01.000Z' })
    listener?.({ type: 'thinking-status', sessionId: snapshot.summary.id, runId: 'run-1', status: 'complete', timestamp: '2026-07-25T05:00:03.000Z' })
    listener?.({ type: 'tool-progress', sessionId: snapshot.summary.id, runId: 'run-1', toolCallId: 'tool-1', toolName: 'bash', summary: 'npm test' })
    listener?.({ type: 'tool-complete', sessionId: snapshot.summary.id, runId: 'run-1', toolCallId: 'tool-1', toolName: 'bash', summary: '全部通过', isError: false })
    listener?.({ type: 'retry-status', sessionId: snapshot.summary.id, runId: 'run-1', attempt: 1, maxAttempts: 3, delayMs: 1000, message: '服务繁忙', status: 'succeeded', timestamp: '2026-07-25T05:00:04.000Z' })
    listener?.({ type: 'usage-delta', sessionId: snapshot.summary.id, runId: 'run-1', usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, total: 15 }, context: { tokens: 40, contextWindow: 100, percent: 40 } })
    listener?.({ type: 'run-complete', sessionId: snapshot.summary.id, runId: 'run-1', context: { tokens: 40, contextWindow: 100, percent: 40 } })

    expect(store.turns[0]).toMatchObject({ state: 'complete', usage: { total: 15 } })
    expect(store.turns[0].activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thinking', status: 'complete', durationMs: 2000 }),
      expect.objectContaining({ type: 'tool', toolName: 'bash', summary: '全部通过', status: 'complete' }),
      expect.objectContaining({ type: 'retry', status: 'succeeded' })
    ]))
    expect(store.contextUsage?.percent).toBe(40)
    expect(store.running).toBe(false)
  })

  it('deduplicates repeated tool events and ignores a previous run', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    await store.send('运行测试')

    const progress: AgentEvent = { type: 'tool-progress', sessionId: snapshot.summary.id, runId: 'run-1', toolCallId: 'tool-1', toolName: 'bash', summary: 'npm test' }
    listener?.(progress)
    listener?.(progress)
    listener?.({ ...progress, runId: 'run-old', toolCallId: 'old-tool' })

    expect(store.turns[0].activities.filter((item) => item.type === 'tool')).toHaveLength(1)
    expect(store.running).toBe(true)
  })

  it('marks cancellation once and removes the empty assistant placeholder', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    await store.send('停止这个任务')

    await store.cancel()

    expect(bridge.cancelRun).toHaveBeenCalledWith(snapshot.summary.id)
    expect(store.turns[0].state).toBe('cancelled')
    expect(store.turns[0].assistant).toBeUndefined()
    expect(store.lastRunState).toBe('cancelled')
  })

  it('prevents duplicate sends across automatic session creation', async () => {
    let resolvePrompt: ((value: { runId: string; contract: RunContract }) => void) | undefined
    bridge.sendPrompt = vi.fn().mockImplementation(() => new Promise((resolve) => { resolvePrompt = resolve }))
    const store = useAgentStore()
    await store.initialize()

    const first = store.send('只执行一次')
    const second = store.send('重复提交')
    await Promise.resolve()

    expect(await second).toBe(false)
    expect(bridge.createSession).toHaveBeenCalledTimes(1)
    resolvePrompt?.({ runId: 'run-1', contract })
    expect(await first).toBe(true)
    expect(bridge.sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('does not restore run identifiers after an immediate completion event', async () => {
    bridge.sendPrompt = vi.fn().mockImplementation(async () => {
      listener?.({ type: 'run-complete', sessionId: snapshot.summary.id, runId: 'run-fast' })
      return { runId: 'run-fast', contract }
    })
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)

    await store.send('快速完成')

    expect(store.running).toBe(false)
    expect(store.activeRunId).toBe('')
    expect(store.activeContract).toBeUndefined()
  })

  it('keeps the task running when cancellation IPC fails', async () => {
    bridge.cancelRun = vi.fn().mockRejectedValue(new Error('IPC unavailable'))
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    await store.send('继续运行')

    await store.cancel()

    expect(store.running).toBe(true)
    expect(store.error).toContain('中止失败')
    await expect(store.openSession('another')).rejects.toThrow('不能切换会话')
  })

  it('queues a follow-up once and starts a new visible turn when it is consumed', async () => {
    const item = { id: 'queued-1', mode: 'follow-up' as const, text: '完成后运行回归测试', createdAt: '2026-07-25T05:01:00.000Z' }
    let resolveQueue: ((value: { items: typeof item[] }) => void) | undefined
    bridge.queuePrompt = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveQueue = resolve }))
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    await store.send('先修复问题')

    const first = store.queueMessage(item.text, item.mode)
    const duplicate = store.queueMessage('重复点击', item.mode)
    expect(await duplicate).toBe(false)
    resolveQueue?.({ items: [item] })
    expect(await first).toBe(true)
    expect(bridge.queuePrompt).toHaveBeenCalledTimes(1)
    expect(store.queuedMessages).toEqual([item])

    listener?.({ type: 'queue-updated', sessionId: snapshot.summary.id, runId: 'run-1', queue: { items: [] } })
    listener?.({ type: 'queued-message-start', sessionId: snapshot.summary.id, runId: 'run-1', item })
    listener?.({ type: 'text-delta', sessionId: snapshot.summary.id, runId: 'run-1', delta: '测试通过。' })
    listener?.({ type: 'run-complete', sessionId: snapshot.summary.id, runId: 'run-1' })

    expect(store.turns).toHaveLength(2)
    expect(store.turns[0].state).toBe('complete')
    expect(store.turns[1]).toMatchObject({ state: 'complete', user: { text: item.text }, assistant: { text: '测试通过。' } })
    expect(store.queuedMessages).toEqual([])
  })

  it('updates context usage after an idle manual compaction', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)

    const result = await store.compactContext()

    expect(result).toMatchObject({ tokensBefore: 20, estimatedTokensAfter: 8 })
    expect(store.contextUsage?.percent).toBe(8)
    expect(store.transitioning).toBe(false)
    expect(bridge.compactSession).toHaveBeenCalledWith(snapshot.summary.id)
  })

  it('keeps a visible resource error after the first load fails', async () => {
    bridge.listAgentResources = vi.fn().mockRejectedValue(new Error('trust.json 无法读取'))
    const store = useAgentStore()
    await store.initialize()

    await expect(store.loadAgentResources()).rejects.toThrow('trust.json 无法读取')

    expect(store.resourcesLoading).toBe(false)
    expect(store.resourceError).toContain('trust.json 无法读取')
    expect(store.agentResources).toBeUndefined()
  })

  it('leaves the old session when the selected workspace changes', async () => {
    bridge.selectWorkspace = vi.fn().mockResolvedValue({ path: 'C:\\work\\another-project' })
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)

    await store.chooseWorkspace()

    expect(store.settings?.workspace.path).toBe('C:\\work\\another-project')
    expect(store.currentSession).toBeUndefined()
    expect(store.turns).toEqual([])
    expect(store.contextUsage).toBeUndefined()
  })

  it('does not change project trust while resources are still loading', async () => {
    let resolveResources: ((value: Awaited<ReturnType<AgentBridge['listAgentResources']>>) => void) | undefined
    bridge.listAgentResources = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveResources = resolve }))
    const store = useAgentStore()
    await store.initialize()

    const loading = store.loadAgentResources()
    await expect(store.setProjectResourceTrust(true)).rejects.toThrow('正在更新')
    resolveResources?.({
      workspacePath: settings.workspace.path,
      userResourcePath: 'C:\\user-data\\agent',
      projectResourcePath: 'C:\\work\\two-pi\\.pi',
      trust: { required: false, decision: 'unset' },
      resources: [],
      diagnostics: []
    })
    await loading

    expect(bridge.setProjectResourceTrust).not.toHaveBeenCalled()
  })

  it('keeps only the latest asynchronous history search result', async () => {
    const older = { ...snapshot.summary, id: 'old', name: '旧结果' }
    const newer = { ...snapshot.summary, id: 'new', name: '新结果' }
    let resolveOld: ((value: typeof older[]) => void) | undefined
    let resolveNew: ((value: typeof newer[]) => void) | undefined
    bridge.searchSessions = vi.fn().mockImplementation((query: string) => new Promise((resolve) => {
      if (query === '旧') resolveOld = resolve
      else resolveNew = resolve
    }))
    const store = useAgentStore()
    await store.initialize()

    const oldSearch = store.searchHistory('旧')
    const newSearch = store.searchHistory('新')
    resolveNew?.([newer])
    await newSearch
    resolveOld?.([older])
    await oldSearch

    expect(store.sessions.map((item) => item.id)).toEqual(['new'])
  })

  it('renames the current session and guards duplicate branch clicks', async () => {
    const branchResult = {
      snapshot: { ...structuredClone(snapshot), summary: { ...snapshot.summary, name: '新名称' } },
      tree: { sessionId: snapshot.summary.id, leafId: 'branch-summary', nodes: [] },
      summary: '已生成分支摘要'
    }
    bridge.branchSession = vi.fn().mockResolvedValue(branchResult)
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)

    await store.renameHistorySession(snapshot.summary.id, '新名称')
    const first = store.branchFromNode('assistant-entry')
    const duplicate = store.branchFromNode('assistant-entry')

    expect(await duplicate).toBeUndefined()
    expect(await first).toBe('已生成分支摘要')
    expect(bridge.renameSession).toHaveBeenCalledWith(snapshot.summary.id, '新名称')
    expect(bridge.branchSession).toHaveBeenCalledTimes(1)
    expect(store.currentSession?.name).toBe('新名称')
    expect(store.branchSubmitting).toBe(false)
  })

  it('loads the current workspace Git diff through the typed bridge', async () => {
    const store = useAgentStore()
    await store.initialize()

    await store.loadGitDiff()

    expect(bridge.getGitDiff).toHaveBeenCalledTimes(1)
    expect(store.gitDiff?.state).toBe('ready')
    expect(store.diffLoading).toBe(false)
  })
})
