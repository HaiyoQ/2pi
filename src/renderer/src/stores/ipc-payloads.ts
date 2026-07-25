import type { AgentPreferences, PromptInput, ProviderDraft } from '../../../shared/contracts'

export function providerDraftPayload(draft: ProviderDraft): ProviderDraft {
  return {
    id: draft.id,
    type: draft.type,
    name: draft.name,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl,
    models: draft.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input ? [...model.input] : undefined,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      toolUse: model.toolUse
    })),
    apiKey: draft.apiKey,
    clearApiKey: draft.clearApiKey,
    headers: draft.headers.map((header) => ({ name: header.name, value: header.value }))
  }
}

export function agentPreferencesPayload(preferences: AgentPreferences): AgentPreferences {
  return {
    executionMode: preferences.executionMode,
    thinkingLevel: preferences.thinkingLevel,
    autoRetry: preferences.autoRetry,
    enabledTools: [...preferences.enabledTools]
  }
}

export function promptInputPayload(input: PromptInput): PromptInput {
  return {
    text: input.text,
    images: input.images.map((image) => ({ data: image.data, mimeType: image.mimeType }))
  }
}
