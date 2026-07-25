import type { ConnectionTestResult, ProviderModel, ProviderProtocol } from '../../shared/contracts'

export interface ProviderConnectionConfig {
  protocol: ProviderProtocol
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
}

export async function testProviderConnection(
  config: ProviderConnectionConfig,
  timeoutMs = 15_000,
  fetcher: typeof fetch = fetch
): Promise<ConnectionTestResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(modelsUrl(config.baseUrl, config.protocol), {
      method: 'GET',
      headers: requestHeaders(config),
      signal: controller.signal
    })
    if (!response.ok) return { ok: false, ...statusResult(response.status), models: [] }
    let payload: unknown
    try { payload = await response.json() } catch {
      return { ok: false, message: '服务返回了无法解析的模型列表', models: [], failedField: 'baseUrl' }
    }
    const models = parseModelList(config.protocol, payload)
    return {
      ok: true,
      message: models.length ? `连接成功，发现 ${models.length} 个模型` : '连接成功，但服务未返回可用模型',
      models
    }
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, message: '连接超时，请检查地址或网络', models: [], failedField: 'baseUrl' }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `连接失败：${safeMessage(message)}`, models: [], failedField: 'baseUrl' }
  } finally {
    clearTimeout(timeout)
  }
}

export function modelsUrl(baseUrl: string, protocol: ProviderProtocol): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (protocol === 'anthropic-messages' && !/\/v1$/i.test(normalized)) return `${normalized}/v1/models`
  return `${normalized}/models`
}

export function requestHeaders(config: ProviderConnectionConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.apiKey) {
    if (config.protocol === 'anthropic-messages') {
      headers['x-api-key'] = config.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else if (config.protocol === 'google-generative-ai') {
      headers['x-goog-api-key'] = config.apiKey
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`
    }
  }
  return { ...headers, ...config.headers }
}

export function parseModelList(protocol: ProviderProtocol, value: unknown): ProviderModel[] {
  if (!value || typeof value !== 'object') return []
  const root = value as Record<string, unknown>
  const raw = protocol === 'google-generative-ai' ? root.models : root.data
  if (!Array.isArray(raw)) return []
  const result = new Map<string, ProviderModel>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const model = item as Record<string, unknown>
    const rawId = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : ''
    const id = protocol === 'google-generative-ai' ? rawId.replace(/^models\//, '') : rawId
    if (!id) continue
    const name = typeof model.displayName === 'string' ? model.displayName
      : typeof model.display_name === 'string' ? model.display_name
        : id
    result.set(id, {
      id,
      name,
      reasoning: /reason|thinking|o[134](?:-|$)/i.test(id),
      input: inferredInput(protocol, id, model),
      contextWindow: inferredLimit(model.context_window ?? model.contextWindow ?? model.inputTokenLimit, 128_000),
      maxTokens: inferredLimit(model.max_output_tokens ?? model.maxTokens ?? model.outputTokenLimit, 16_000),
      toolUse: true
    })
  }
  return [...result.values()]
}

function inferredInput(protocol: ProviderProtocol, id: string, model: Record<string, unknown>): ('text' | 'image')[] {
  const capabilities = model.capabilities
  const acceptsImage = Array.isArray(model.input_modalities) && model.input_modalities.includes('image')
    || Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.some((item) => item === 'generateContent')
    || Boolean(capabilities && typeof capabilities === 'object' && (capabilities as Record<string, unknown>).vision)
    || protocol === 'google-generative-ai'
    || /gpt-4(?:o|\.1)|gpt-5|vision|claude|gemini|qwen.*vl|llava/i.test(id)
  return acceptsImage ? ['text', 'image'] : ['text']
}

function inferredLimit(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10_000_000) return value
  return fallback
}

function statusResult(status: number): Pick<ConnectionTestResult, 'message' | 'failedField'> {
  if (status === 401 || status === 403) {
    return { message: '认证失败，请检查 API Key 和请求头', failedField: 'apiKey' }
  }
  if (status === 404) {
    return { message: '连接成功，但该地址没有模型列表接口；可以手动填写模型 ID', failedField: 'baseUrl' }
  }
  if (status === 429) return { message: '请求过于频繁，请稍后重试' }
  return { message: `模型服务返回 HTTP ${status}` }
}

function safeMessage(message: string): string {
  return message.replace(/https?:\/\/\S+/g, '模型服务').slice(0, 160)
}
