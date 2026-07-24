import type { ActiveModel, ProviderDraft, ProviderHeaderDraft, ProviderModel, ProviderProtocol } from '../../shared/contracts'

const protocols = new Set<ProviderProtocol>([
  'openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai'
])
const forbiddenHeaders = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'proxy-authenticate', 'proxy-authorization'
])

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

export function parseActiveModel(value: unknown): ActiveModel {
  if (!value || typeof value !== 'object') throw new Error('模型配置无效')
  const input = value as Record<string, unknown>
  return {
    providerId: requireNonEmpty(input.providerId, '供应商 ID', 200),
    modelId: requireNonEmpty(input.modelId, '模型 ID', 300)
  }
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
      reasoning: input.reasoning === true
    }
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
