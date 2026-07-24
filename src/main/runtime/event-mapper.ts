import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AgentEvent } from '../../shared/contracts'
import { friendlyError } from './validation'

export function mapSdkEvent(event: AgentSessionEvent, sessionId: string, runId: string): AgentEvent | undefined {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    return { type: 'text-delta', sessionId, runId, delta: event.assistantMessageEvent.delta }
  }
  if (event.type === 'tool_execution_start') {
    return { type: 'tool-progress', sessionId, runId, toolCallId: event.toolCallId, toolName: event.toolName, summary: '正在执行' }
  }
  if (event.type === 'tool_execution_update') {
    return { type: 'tool-progress', sessionId, runId, toolCallId: event.toolCallId, toolName: event.toolName, summary: summarize(event.partialResult) }
  }
  if (event.type === 'tool_execution_end') {
    return { type: 'tool-complete', sessionId, runId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, summary: summarize(event.result) }
  }
  if (event.type === 'message_end') {
    const message = event.message as { role?: string; stopReason?: string; errorMessage?: string }
    if (message.role === 'assistant' && message.stopReason === 'error') {
      return { type: 'run-failed', sessionId, runId, message: friendlyError(message.errorMessage || '模型响应失败') }
    }
  }
  if (event.type === 'agent_settled') return { type: 'run-complete', sessionId, runId }
  return undefined
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 240)
  if (value && typeof value === 'object' && 'content' in value) return summarize((value as { content: unknown }).content)
  try { return JSON.stringify(value).slice(0, 240) } catch { return '已更新' }
}
