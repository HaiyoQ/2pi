import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { mapSdkEvent } from '../src/main/runtime/event-mapper'

describe('mapSdkEvent', () => {
  it('转换文本流增量', () => {
    const event = {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你好', partial: {} }
    } as AgentSessionEvent
    expect(mapSdkEvent(event, 's1', 'r1')).toEqual({ type: 'text-delta', sessionId: 's1', runId: 'r1', delta: '你好' })
  })

  it('转换工具完成事件', () => {
    const event = { type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: 'ok', isError: false } as AgentSessionEvent
    expect(mapSdkEvent(event, 's1', 'r1')).toMatchObject({ type: 'tool-complete', toolCallId: 't1', isError: false })
  })

  it('为文件修改工具保留目标路径用于关联实际 diff', () => {
    const event = { type: 'tool_execution_start', toolCallId: 't2', toolName: 'edit', args: { path: 'src/main/ipc.ts' } } as AgentSessionEvent
    expect(mapSdkEvent(event, 's1', 'r1')).toMatchObject({ type: 'tool-progress', targetPath: 'src/main/ipc.ts' })
  })

  it('只映射 thinking 生命周期，不转发原始内容', () => {
    const event = {
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'thinking_start', contentIndex: 0, partial: { content: [{ type: 'thinking', thinking: '秘密推理' }] } }
    } as AgentSessionEvent
    const mapped = mapSdkEvent(event, 's1', 'r1')
    expect(mapped).toMatchObject({ type: 'thinking-status', sessionId: 's1', runId: 'r1', status: 'running' })
    expect(JSON.stringify(mapped)).not.toContain('秘密推理')
  })

  it('转换用量并附带上下文占用', () => {
    const event = {
      type: 'message_end',
      message: { role: 'assistant', usage: { input: 12, output: 8, cacheRead: 2, cacheWrite: 1, totalTokens: 23 } }
    } as AgentSessionEvent
    expect(mapSdkEvent(event, 's1', 'r1', { tokens: 50, contextWindow: 100, percent: 50 })).toEqual({
      type: 'usage-delta', sessionId: 's1', runId: 'r1',
      usage: { input: 12, output: 8, cacheRead: 2, cacheWrite: 1, total: 23 },
      context: { tokens: 50, contextWindow: 100, percent: 50 }
    })
  })
})
