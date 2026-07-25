/* @vitest-environment jsdom */

import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import { agentPreferencesPayload, promptInputPayload, providerDraftPayload } from './ipc-payloads'

describe('renderer IPC payloads', () => {
  it('removes nested Vue proxies from a provider draft', () => {
    const draft = reactive({
      id: 'xiaomi',
      type: 'builtin' as const,
      name: 'Xiaomi',
      protocol: 'openai-chat' as const,
      baseUrl: 'https://api.xiaomimimo.com/v1',
      models: [{
        id: 'mimo-v2.5-pro', name: 'mimo-v2.5-pro', reasoning: true,
        input: ['text', 'image'] as ('text' | 'image')[], contextWindow: 128_000,
        maxTokens: 16_000, toolUse: true
      }],
      apiKey: 'secret',
      headers: [{ name: 'X-Test', value: 'value' }]
    })

    expect(() => structuredClone(draft)).toThrow(/could not be cloned/)
    expect(() => structuredClone(providerDraftPayload(draft))).not.toThrow()
  })

  it('removes proxies from the other array-bearing IPC inputs', () => {
    const preferences = reactive({
      executionMode: 'full-auto' as const,
      thinkingLevel: 'medium' as const,
      autoRetry: true,
      enabledTools: ['read', 'write'] as ('read' | 'write')[]
    })
    const prompt = reactive({
      text: '检查图片',
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' as const }]
    })

    expect(() => structuredClone(agentPreferencesPayload(preferences))).not.toThrow()
    expect(() => structuredClone(promptInputPayload(prompt))).not.toThrow()
  })
})
