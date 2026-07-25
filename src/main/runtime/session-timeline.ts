import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'
import type { PromptImage, TimelineActivity, TimelineMessage, TimelineTurn, TokenUsage } from '../../shared/contracts'
import { friendlyError } from './validation'

export const RETRY_ENTRY_TYPE = '2pi.retry'
export const RUN_ERROR_ENTRY_TYPE = '2pi.run-error'

export interface PersistedRetryEvent {
  runId: string
  attempt: number
  maxAttempts: number
  delayMs: number
  message: string
  status: 'waiting' | 'running' | 'succeeded' | 'failed'
}

export function buildSessionTimeline(manager: SessionManager): TimelineTurn[] {
  const turns: TimelineTurn[] = []
  let current: TimelineTurn | undefined

  for (const entry of manager.getBranch()) {
    if (entry.type === 'message') {
      const message = entry.message as unknown as Record<string, unknown>
      if (message.role === 'user') {
        current = createTurn(entry.id, entry.timestamp, message)
        turns.push(current)
      } else if (message.role === 'assistant' && current) {
        applyAssistantEntry(current, entry.id, entry.timestamp, message)
      } else if (message.role === 'toolResult' && current) {
        applyToolResult(current, entry.timestamp, message)
      }
    } else if (entry.type === 'custom' && entry.customType === RETRY_ENTRY_TYPE && current) {
      applyPersistedRetry(current, entry)
    } else if (entry.type === 'custom' && entry.customType === RUN_ERROR_ENTRY_TYPE && current && isRecord(entry.data) && typeof entry.data.message === 'string') {
      current.state = 'failed'
      current.error = friendlyError(entry.data.message)
    }
  }

  for (const turn of turns) {
    if (turn.state === 'running') turn.state = 'cancelled'
  }
  return turns
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function createTurn(id: string, timestamp: string, message: Record<string, unknown>): TimelineTurn {
  const user: TimelineMessage = {
    id,
    role: 'user',
    text: textContent(message.content),
    images: imageContent(message.content),
    timestamp: normalizeTimestamp(message.timestamp, timestamp)
  }
  return { id, user, activities: [], state: 'running', usage: emptyTokenUsage() }
}

function applyAssistantEntry(turn: TimelineTurn, entryId: string, timestamp: string, message: Record<string, unknown>): void {
  const content = Array.isArray(message.content) ? message.content : []
  const text = content.flatMap((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('')
  if (text) {
    const messageTimestamp = normalizeTimestamp(message.timestamp, timestamp)
    if (turn.assistant) turn.assistant.text += text
    else turn.assistant = { id: entryId, role: 'assistant', text, images: [], timestamp: messageTimestamp }
  }

  content.forEach((part, index) => {
    if (!isRecord(part)) return
    if (part.type === 'thinking') {
      turn.activities.push({
        id: `${entryId}:thinking:${index}`,
        type: 'thinking',
        status: 'complete',
        timestamp: normalizeTimestamp(message.timestamp, timestamp)
      })
    } else if (part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string') {
      turn.activities.push({
        id: `tool:${part.id}`,
        type: 'tool',
        toolCallId: part.id,
        toolName: part.name,
        summary: summarizeToolCall(part.name, isRecord(part.arguments) ? part.arguments : {}),
        targetPath: toolTargetPath(part.name, isRecord(part.arguments) ? part.arguments : {}),
        status: 'running',
        timestamp: normalizeTimestamp(message.timestamp, timestamp)
      })
    }
  })

  addUsage(turn.usage, message.usage)
  if (message.stopReason === 'error') {
    turn.state = 'failed'
    turn.error = friendlyError(typeof message.errorMessage === 'string' ? message.errorMessage : '模型响应失败')
  } else if (message.stopReason === 'aborted') {
    turn.state = 'cancelled'
  } else if (message.stopReason === 'stop' || message.stopReason === 'length') {
    turn.state = 'complete'
    turn.error = undefined
  }
}

function applyToolResult(turn: TimelineTurn, timestamp: string, message: Record<string, unknown>): void {
  if (typeof message.toolCallId !== 'string') return
  const existing = turn.activities.find((activity): activity is Extract<TimelineActivity, { type: 'tool' }> =>
    activity.type === 'tool' && activity.toolCallId === message.toolCallId)
  const summary = textContent(message.content).slice(0, 240) || (message.isError === true ? '执行失败' : '已完成')
  if (existing) {
    existing.status = message.isError === true ? 'error' : 'complete'
    existing.summary = summary
  } else {
    turn.activities.push({
      id: `tool:${message.toolCallId}`,
      type: 'tool',
      toolCallId: message.toolCallId,
      toolName: typeof message.toolName === 'string' ? message.toolName : 'tool',
      summary,
      status: message.isError === true ? 'error' : 'complete',
      timestamp: normalizeTimestamp(message.timestamp, timestamp)
    })
  }
  if (message.isError === true) {
    turn.state = 'failed'
    turn.error = summary
  }
}

function applyPersistedRetry(turn: TimelineTurn, entry: SessionEntry & { type: 'custom' }): void {
  const data = entry.data
  if (!isPersistedRetry(data)) return
  const existing = turn.activities.find((activity): activity is Extract<TimelineActivity, { type: 'retry' }> =>
    activity.type === 'retry' && activity.attempt === data.attempt)
  const value: Extract<TimelineActivity, { type: 'retry' }> = {
    id: `retry:${data.runId}:${data.attempt}`,
    type: 'retry',
    attempt: data.attempt,
    maxAttempts: data.maxAttempts,
    delayMs: data.delayMs,
    message: data.message,
    status: data.status,
    timestamp: entry.timestamp
  }
  if (existing) Object.assign(existing, value)
  else turn.activities.push(value)
}

function addUsage(target: TokenUsage, value: unknown): void {
  if (!isRecord(value)) return
  target.input += finiteNumber(value.input)
  target.output += finiteNumber(value.output)
  target.cacheRead += finiteNumber(value.cacheRead)
  target.cacheWrite += finiteNumber(value.cacheWrite)
  target.total += finiteNumber(value.totalTokens)
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('')
}

function imageContent(content: unknown): PromptImage[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part): PromptImage[] => isRecord(part)
    && part.type === 'image'
    && typeof part.data === 'string'
    && (part.mimeType === 'image/png' || part.mimeType === 'image/jpeg' || part.mimeType === 'image/webp' || part.mimeType === 'image/gif')
    ? [{ data: part.data, mimeType: part.mimeType }]
    : [])
}

function summarizeToolCall(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'bash') return String(input.command ?? '').slice(0, 240) || '运行命令'
  const target = String(input.path ?? input.file_path ?? '').slice(0, 240)
  if (target) return target
  try { return JSON.stringify(input).slice(0, 240) } catch { return '准备执行' }
}

function toolTargetPath(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== 'edit' && toolName !== 'write') return undefined
  const target = input.path ?? input.file_path
  return typeof target === 'string' && target ? target.slice(0, 1000) : undefined
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  const date = typeof value === 'number' || typeof value === 'string' ? new Date(value) : new Date(fallback)
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString()
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPersistedRetry(value: unknown): value is PersistedRetryEvent {
  if (!isRecord(value)) return false
  return typeof value.runId === 'string' && typeof value.attempt === 'number'
    && typeof value.maxAttempts === 'number' && typeof value.delayMs === 'number'
    && typeof value.message === 'string'
    && (value.status === 'waiting' || value.status === 'running' || value.status === 'succeeded' || value.status === 'failed')
}
