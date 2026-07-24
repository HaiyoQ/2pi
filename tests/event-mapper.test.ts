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

  it('将模型认证异常转换为可理解的失败事件', () => {
    const event = {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: '401 unauthorized api key' }
    } as AgentSessionEvent
    expect(mapSdkEvent(event, 's1', 'r1')).toEqual({
      type: 'run-failed', sessionId: 's1', runId: 'r1', message: 'API Key 无效或未配置，请在设置中检查。'
    })
  })
})
