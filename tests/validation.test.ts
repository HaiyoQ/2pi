import { describe, expect, it } from 'vitest'
import { parseActiveModel, parseAgentPreferences, parsePromptInput, parseProviderConnectionDraft, parseProviderDraft, requireNonEmpty } from '../src/main/runtime/validation'

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

  it('连接测试不要求预先配置模型', () => {
    const input = {
      id: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.example.com/v1/',
      apiKey: 'secret', clearApiKey: false, headers: [], models: []
    }
    expect(parseProviderConnectionDraft(input)).toEqual({
      id: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret', clearApiKey: false, headers: []
    })
    expect(() => parseProviderDraft({ ...input, type: 'builtin', name: 'OpenAI' })).toThrow('请至少配置一个模型')
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

  it('校验 Agent 设置并拒绝未知或重复工具', () => {
    expect(parseAgentPreferences({
      executionMode: 'read-only', thinkingLevel: 'high', autoRetry: false, enabledTools: ['read', 'grep']
    })).toEqual({ executionMode: 'read-only', thinkingLevel: 'high', autoRetry: false, enabledTools: ['read', 'grep'] })
    expect(() => parseAgentPreferences({ executionMode: 'manual', thinkingLevel: 'high', autoRetry: false, enabledTools: [] })).toThrow('执行档位无效')
    expect(() => parseAgentPreferences({ executionMode: 'full-auto', thinkingLevel: 'ultra', autoRetry: false, enabledTools: [] })).toThrow('思考级别无效')
    expect(() => parseAgentPreferences({ executionMode: 'full-auto', thinkingLevel: 'medium', autoRetry: true, enabledTools: ['read', 'read'] })).toThrow('重复')
    expect(() => parseAgentPreferences({ executionMode: 'full-auto', thinkingLevel: 'medium', autoRetry: true, enabledTools: ['download'] })).toThrow('未知工具')
  })

  it('限制图片消息的 MIME、数量和解码后大小', () => {
    const image = { mimeType: 'image/png', data: Buffer.from('image').toString('base64') }
    expect(parsePromptInput({ text: '', images: [image] })).toEqual({ text: '', images: [image] })
    expect(() => parsePromptInput({ text: '', images: [{ ...image, mimeType: 'image/svg+xml' }] })).toThrow('图片格式')
    expect(() => parsePromptInput({ text: '', images: [image, image, image, image, image] })).toThrow('最多')
    expect(() => parsePromptInput({ text: '', images: [{ ...image, data: 'not base64!' }] })).toThrow('图片数据')
  })
})
