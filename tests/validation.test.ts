import { describe, expect, it } from 'vitest'
import { parseActiveModel, parseProviderDraft, requireNonEmpty } from '../src/main/runtime/validation'

describe('IPC 参数校验', () => {
  it('拒绝空字符串和非字符串', () => {
    expect(() => requireNonEmpty('  ', '任务')).toThrow('任务无效')
    expect(() => requireNonEmpty(12, '任务')).toThrow('任务无效')
  })

  it('接收四种协议并规范化 Base URL', () => {
    for (const protocol of ['openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const) {
      expect(parseProviderDraft({
        type: 'custom', name: '测试', protocol, baseUrl: 'https://api.example.com/v1/',
        headers: [], models: [{ id: 'model', name: 'Model', reasoning: false }]
      }).baseUrl).toBe('https://api.example.com/v1')
    }
  })

  it('拒绝危险请求头、换行和重复模型', () => {
    const base = { type: 'custom', name: '测试', protocol: 'openai-chat', baseUrl: 'https://api.example.com/v1' }
    expect(() => parseProviderDraft({ ...base, headers: [{ name: 'Host', value: 'evil' }], models: [{ id: 'x' }] })).toThrow('不允许使用请求头')
    expect(() => parseProviderDraft({ ...base, headers: [{ name: 'X-Test', value: 'a\nb' }], models: [{ id: 'x' }] })).toThrow('请求头值无效')
    expect(() => parseProviderDraft({ ...base, headers: [], models: [{ id: 'x' }, { id: 'x' }] })).toThrow('模型 ID 重复')
    expect(() => parseProviderDraft({ ...base, baseUrl: 'https://api.example.com/v1?api_key=secret', headers: [], models: [{ id: 'x' }] })).toThrow('安全的 HTTP')
  })

  it('校验激活模型参数', () => {
    expect(parseActiveModel({ providerId: 'custom-one', modelId: 'model-a' })).toEqual({ providerId: 'custom-one', modelId: 'model-a' })
    expect(() => parseActiveModel({ providerId: '', modelId: 'x' })).toThrow()
  })
})
