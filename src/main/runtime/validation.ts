import { AGENT_TOOL_NAMES } from '../../shared/contracts'
import type { ActiveModel, AgentPreferences, AgentToolName, ImageMimeType, PromptImage, PromptInput, ProviderConnectionDraft, ProviderDraft, ProviderHeaderDraft, ProviderModel, ProviderProtocol, ThinkingLevel } from '../../shared/contracts'

const protocols = new Set<ProviderProtocol>([
  'openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai'
])
const thinkingLevels = new Set<ThinkingLevel>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const agentTools = new Set<AgentToolName>(AGENT_TOOL_NAMES)
const forbiddenHeaders = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'proxy-authenticate', 'proxy-authorization'
])
const imageMimeTypes = new Set<ImageMimeType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const maxImagesPerPrompt = 4
const maxImageBytes = 8 * 1024 * 1024

export function requireNonEmpty(value: unknown, field: string, maxLength = 20_000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field}无效`)
  }
  return value.trim()
}

export function parseProviderDraft(value: unknown): ProviderDraft {
  if (!value || typeof value !== 'object') throw new Error('供应商配置无效')
  const input = value as Record<string, unknown>
  const type = input.type
  if (type !== 'builtin' && type !== 'custom') throw new Error('供应商类型无效')
  const protocol = input.protocol
  if (!protocols.has(protocol as ProviderProtocol)) throw new Error('供应商协议无效')
  const baseUrl = parseBaseUrl(input.baseUrl)
  const models = parseModels(input.models)
  const headers = parseHeaders(input.headers)
  const id = input.id === undefined ? undefined : requireNonEmpty(input.id, '供应商 ID', 200)
  if (type === 'builtin' && !id) throw new Error('内置供应商 ID 无效')
  return {
    id,
    type,
    name: requireNonEmpty(input.name, '供应商名称', 100),
    protocol: protocol as ProviderProtocol,
    baseUrl,
    models,
    apiKey: input.apiKey === undefined ? undefined : requireNonEmpty(input.apiKey, 'API Key', 10_000),
    clearApiKey: input.clearApiKey === true,
    headers
  }
}

export function parseProviderConnectionDraft(value: unknown): ProviderConnectionDraft {
  if (!value || typeof value !== 'object') throw new Error('供应商连接配置无效')
  const input = value as Record<string, unknown>
  const protocol = input.protocol
  if (!protocols.has(protocol as ProviderProtocol)) throw new Error('供应商协议无效')
  return {
    id: input.id === undefined ? undefined : requireNonEmpty(input.id, '供应商 ID', 200),
    protocol: protocol as ProviderProtocol,
    baseUrl: parseBaseUrl(input.baseUrl),
    apiKey: input.apiKey === undefined ? undefined : requireNonEmpty(input.apiKey, 'API Key', 10_000),
    clearApiKey: input.clearApiKey === true,
    headers: parseHeaders(input.headers)
  }
}

export function parseActiveModel(value: unknown): ActiveModel {
  if (!value || typeof value !== 'object') throw new Error('模型配置无效')
  const input = value as Record<string, unknown>
  return {
    providerId: requireNonEmpty(input.providerId, '供应商 ID', 200),
    modelId: requireNonEmpty(input.modelId, '模型 ID', 300)
  }
}

export function parseAgentPreferences(value: unknown): AgentPreferences {
  if (!value || typeof value !== 'object') throw new Error('Agent 设置无效')
  const input = value as Record<string, unknown>
  if (input.executionMode !== 'read-only' && input.executionMode !== 'full-auto') throw new Error('执行档位无效')
  if (!thinkingLevels.has(input.thinkingLevel as ThinkingLevel)) throw new Error('思考级别无效')
  if (typeof input.autoRetry !== 'boolean') throw new Error('自动重试设置无效')
  if (!Array.isArray(input.enabledTools) || input.enabledTools.length > AGENT_TOOL_NAMES.length) throw new Error('工具设置无效')
  const enabledTools = input.enabledTools.map((tool) => {
    if (!agentTools.has(tool as AgentToolName)) throw new Error(`未知工具：${String(tool)}`)
    return tool as AgentToolName
  })
  if (new Set(enabledTools).size !== enabledTools.length) throw new Error('工具设置包含重复项')
  return {
    executionMode: input.executionMode,
    thinkingLevel: input.thinkingLevel as ThinkingLevel,
    autoRetry: input.autoRetry,
    enabledTools
  }
}

export function parsePromptInput(value: unknown): PromptInput {
  if (!value || typeof value !== 'object') throw new Error('任务内容无效')
  const input = value as Record<string, unknown>
  const text = typeof input.text === 'string' && input.text.length <= 20_000 ? input.text.trim() : ''
  if (input.text !== undefined && typeof input.text !== 'string') throw new Error('任务内容无效')
  if (typeof input.text === 'string' && input.text.length > 20_000) throw new Error('任务内容无效')
  const images = parsePromptImages(input.images)
  if (!text && !images.length) throw new Error('请输入任务内容或添加图片')
  return { text, images }
}

function parseBaseUrl(value: unknown): string {
  const raw = requireNonEmpty(value, 'Base URL', 2_000).replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error('Base URL 必须是完整的 HTTP 或 HTTPS 地址') }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base URL 必须是安全的 HTTP 或 HTTPS 地址')
  }
  return raw
}

function parseModels(value: unknown): ProviderModel[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) throw new Error('请至少配置一个模型')
  const seen = new Set<string>()
  return value.map((model): ProviderModel => {
    if (!model || typeof model !== 'object') throw new Error('模型配置无效')
    const input = model as Record<string, unknown>
    const id = requireNonEmpty(input.id, '模型 ID', 300)
    if (seen.has(id)) throw new Error(`模型 ID 重复：${id}`)
    seen.add(id)
    return {
      id,
      name: input.name === undefined ? id : requireNonEmpty(input.name, '模型名称', 300),
      reasoning: input.reasoning === true,
      input: parseModelInput(input.input),
      contextWindow: parseModelLimit(input.contextWindow, '上下文窗口', 128_000, 1_024, 10_000_000),
      maxTokens: parseModelLimit(input.maxTokens, '最大输出', 16_000, 1, 10_000_000),
      toolUse: input.toolUse !== false
    }
  })
}

function parseModelInput(value: unknown): ('text' | 'image')[] {
  if (value === undefined) return ['text']
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) throw new Error('模型输入类型无效')
  const result = [...new Set(value)]
  if (!result.every((item) => item === 'text' || item === 'image') || !result.includes('text')) throw new Error('模型必须支持文本输入')
  return result as ('text' | 'image')[]
}

function parseModelLimit(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${field}无效`)
  return value
}

function parsePromptImages(value: unknown): PromptImage[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxImagesPerPrompt) throw new Error(`每条消息最多添加 ${maxImagesPerPrompt} 张图片`)
  return value.map((image): PromptImage => {
    if (!image || typeof image !== 'object') throw new Error('图片附件无效')
    const item = image as Record<string, unknown>
    if (!imageMimeTypes.has(item.mimeType as ImageMimeType)) throw new Error('图片格式仅支持 PNG、JPEG、WebP 或 GIF')
    if (typeof item.data !== 'string' || !item.data || item.data.length > Math.ceil(maxImageBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data) || item.data.length % 4 !== 0) {
      throw new Error('图片数据无效')
    }
    const bytes = Buffer.from(item.data, 'base64')
    if (!bytes.length || bytes.length > maxImageBytes || bytes.toString('base64') !== item.data) throw new Error('单张图片不能超过 8 MiB')
    return { data: item.data, mimeType: item.mimeType as ImageMimeType }
  })
}

function parseHeaders(value: unknown): ProviderHeaderDraft[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('请求头配置无效')
  const seen = new Set<string>()
  return value.map((header): ProviderHeaderDraft => {
    if (!header || typeof header !== 'object') throw new Error('请求头配置无效')
    const input = header as Record<string, unknown>
    const name = requireNonEmpty(input.name, '请求头名称', 200)
    const normalized = name.toLowerCase()
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || forbiddenHeaders.has(normalized) || normalized.startsWith('proxy-')) {
      throw new Error(`不允许使用请求头：${name}`)
    }
    if (seen.has(normalized)) throw new Error(`请求头名称重复：${name}`)
    seen.add(normalized)
    const headerValue = input.value
    if (headerValue !== undefined && (typeof headerValue !== 'string' || headerValue.length > 10_000 || /[\r\n]/.test(headerValue))) {
      throw new Error(`请求头值无效：${name}`)
    }
    return { name, value: headerValue as string | undefined }
  })
}

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/api.?key|auth|credential|unauthorized|401/i.test(message)) return 'API Key 无效或未配置，请在设置中检查。'
  if (/network|fetch|timeout|ECONN|ENOTFOUND/i.test(message)) return '无法连接模型服务，请检查网络后重试。'
  if (/aborted|abort/i.test(message)) return '任务已中止。'
  return message.length > 240 ? '运行失败，请检查模型与工作目录配置。' : message
}
