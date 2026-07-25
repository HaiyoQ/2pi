import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AgentEvent, ContextUsage, TokenUsage } from '../../shared/contracts'

export function mapSdkEvent(event: AgentSessionEvent, sessionId: string, runId: string, context?: ContextUsage): AgentEvent | undefined {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    return { type: 'text-delta', sessionId, runId, delta: event.assistantMessageEvent.delta }
  }
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_start') {
    return { type: 'thinking-status', sessionId, runId, status: 'running', timestamp: new Date().toISOString() }
  }
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_end') {
    return { type: 'thinking-status', sessionId, runId, status: 'complete', timestamp: new Date().toISOString() }
  }
  if (event.type === 'tool_execution_start') {
    return {
      type: 'tool-progress', sessionId, runId, toolCallId: event.toolCallId, toolName: event.toolName,
      summary: summarizeToolInput(event.toolName, event.args), targetPath: toolTargetPath(event.toolName, event.args)
    }
  }
  if (event.type === 'tool_execution_update') {
    return { type: 'tool-progress', sessionId, runId, toolCallId: event.toolCallId, toolName: event.toolName, summary: summarize(event.partialResult) }
  }
  if (event.type === 'tool_execution_end') {
    return { type: 'tool-complete', sessionId, runId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, summary: summarize(event.result) }
  }
  if (event.type === 'message_end') {
    const message = event.message as { role?: string; usage?: unknown }
    const usage = message.role === 'assistant' ? toTokenUsage(message.usage) : undefined
    if (usage) return { type: 'usage-delta', sessionId, runId, usage, context }
  }
  return undefined
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 240)
  if (value && typeof value === 'object' && 'content' in value) return summarize((value as { content: unknown }).content)
  try { return JSON.stringify(value).slice(0, 240) } catch { return '已更新' }
}

function summarizeToolInput(toolName: string, value: unknown): string {
  if (!value || typeof value !== 'object') return '正在执行'
  const input = value as Record<string, unknown>
  if (toolName === 'bash') return String(input.command ?? '').slice(0, 240) || '正在运行命令'
  const target = String(input.path ?? input.file_path ?? '').slice(0, 240)
  return target || '正在执行'
}

function toolTargetPath(toolName: string, value: unknown): string | undefined {
  if (toolName !== 'edit' && toolName !== 'write') return undefined
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const target = input.path ?? input.file_path
  return typeof target === 'string' && target ? target.slice(0, 1000) : undefined
}

function toTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    total: finiteNumber(usage.totalTokens)
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
