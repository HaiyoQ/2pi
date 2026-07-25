/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentBridge, AgentEvent, AppSettings, SessionSnapshot } from '../../../shared/contracts'
import { useAgentStore } from './agent'

const settings: AppSettings = {
  version: 2,
  providers: [],
  workspace: { path: 'C:\\work\\two-pi' },
  runtimeBusy: false
}

const snapshot: SessionSnapshot = {
  summary: {
    id: 'session-1',
    name: '修复设置保存顺序',
    path: 'session-1.jsonl',
    workspacePath: settings.workspace.path,
    createdAt: '2026-07-25T05:00:00.000Z',
    updatedAt: '2026-07-25T05:00:00.000Z',
    messageCount: 1
  },
  messages: [{ id: 'assistant-1', role: 'assistant', text: '', timestamp: '2026-07-25T05:00:00.000Z' }]
}

describe('renderer agent store', () => {
  let listener: ((event: AgentEvent) => void) | undefined
  let bridge: AgentBridge

  beforeEach(() => {
    setActivePinia(createPinia())
    listener = undefined
    bridge = {
      getSettings: vi.fn().mockResolvedValue(settings),
      listProviderCatalog: vi.fn().mockResolvedValue([]),
      saveProvider: vi.fn(),
      deleteProvider: vi.fn(),
      testProvider: vi.fn(),
      activateModel: vi.fn(),
      selectWorkspace: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      listSessions: vi.fn().mockResolvedValue([snapshot.summary]),
      createSession: vi.fn().mockResolvedValue(snapshot),
      openSession: vi.fn().mockResolvedValue(snapshot),
      sendPrompt: vi.fn(),
      decideApproval: vi.fn(),
      cancelRun: vi.fn().mockResolvedValue(undefined),
      onAgentEvent: vi.fn((callback) => {
        listener = callback
        return () => undefined
      })
    }
    Object.defineProperty(window, 'agent', { configurable: true, value: bridge })
  })

  it('initializes once and retains the typed bridge as its only data source', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.initialize()

    expect(store.initialized).toBe(true)
    expect(store.workspaceName).toBe('two-pi')
    expect(store.sessions).toEqual([snapshot.summary])
    expect(bridge.getSettings).toHaveBeenCalledTimes(1)
    expect(bridge.onAgentEvent).toHaveBeenCalledTimes(1)
  })

  it('normalizes tool progress, completion and failure for the timeline', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    store.running = true
    store.activeRunId = 'run-1'

    listener?.({ type: 'tool-progress', sessionId: snapshot.summary.id, runId: 'run-1', toolCallId: 'tool-1', toolName: 'bash', summary: 'npm test' })
    expect(store.toolEvents[0]).toMatchObject({ toolName: 'bash', summary: 'npm test', status: 'running' })

    listener?.({ type: 'tool-complete', sessionId: snapshot.summary.id, runId: 'run-1', toolCallId: 'tool-1', toolName: 'bash', summary: '测试失败', isError: true })
    expect(store.toolEvents[0]).toMatchObject({ summary: '测试失败', status: 'error' })

    listener?.({ type: 'run-failed', sessionId: snapshot.summary.id, runId: 'run-1', message: '命令退出码为 1' })
    expect(store.lastRunState).toBe('failed')
    expect(store.error).toBe('命令退出码为 1')
  })

  it('ignores late events from a previous run in the same session', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    store.running = true
    store.activeRunId = 'run-new'

    listener?.({ type: 'tool-progress', sessionId: snapshot.summary.id, runId: 'run-old', toolCallId: 'old-tool', toolName: 'bash', summary: '旧任务输出' })
    listener?.({ type: 'run-complete', sessionId: snapshot.summary.id, runId: 'run-old' })

    expect(store.toolEvents).toEqual([])
    expect(store.running).toBe(true)
    expect(store.activeRunId).toBe('run-new')
  })

  it('marks cancellation locally because the current IPC emits no cancelled event', async () => {
    const store = useAgentStore()
    await store.initialize()
    await store.openSession(snapshot.summary.id)
    store.running = true

    await store.cancel()

    expect(bridge.cancelRun).toHaveBeenCalledWith(snapshot.summary.id)
    expect(store.running).toBe(false)
    expect(store.lastRunState).toBe('cancelled')
    expect(store.messages).toEqual([])
  })
})
