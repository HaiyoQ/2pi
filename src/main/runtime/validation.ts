import type { ModelConfig } from '../../shared/contracts'

export function requireNonEmpty(value: unknown, field: string, maxLength = 20_000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field}无效`)
  }
  return value.trim()
}

export function parseModelConfig(value: unknown): ModelConfig {
  if (!value || typeof value !== 'object') throw new Error('模型配置无效')
  const input = value as Record<string, unknown>
  return {
    provider: requireNonEmpty(input.provider, '模型服务商', 100),
    modelId: requireNonEmpty(input.modelId, '模型 ID', 200),
    apiKey: input.apiKey === undefined ? undefined : requireNonEmpty(input.apiKey, 'API Key', 10_000)
  }
}

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/api.?key|auth|credential|unauthorized|401/i.test(message)) return 'API Key 无效或未配置，请在设置中检查。'
  if (/network|fetch|timeout|ECONN|ENOTFOUND/i.test(message)) return '无法连接模型服务，请检查网络后重试。'
  if (/aborted|abort/i.test(message)) return '任务已中止。'
  return message.length > 240 ? '运行失败，请检查模型与工作目录配置。' : message
}
