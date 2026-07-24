import { describe, expect, it } from 'vitest'
import { parseModelConfig, requireNonEmpty } from '../src/main/runtime/validation'

describe('IPC 参数校验', () => {
  it('拒绝空字符串和非字符串', () => {
    expect(() => requireNonEmpty('  ', '任务')).toThrow('任务无效')
    expect(() => requireNonEmpty(12, '任务')).toThrow('任务无效')
  })

  it('只接收合法模型配置', () => {
    expect(parseModelConfig({ provider: 'openai', modelId: 'gpt-5-mini', apiKey: 'secret' })).toEqual({
      provider: 'openai', modelId: 'gpt-5-mini', apiKey: 'secret'
    })
    expect(() => parseModelConfig({ provider: '', modelId: 'x' })).toThrow()
  })
})
