import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { modelsUrl, parseModelList, requestHeaders, testProviderConnection } from '../src/main/runtime/provider-discovery'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务启动失败')
  return `http://127.0.0.1:${address.port}/v1`
}

describe('供应商连接测试与模型发现', () => {
  it('通过本地 HTTP 服务读取 OpenAI 兼容模型并发送自定义请求头', async () => {
    let requestUrl = ''
    let tenant = ''
    const baseUrl = await serve((request, response) => {
      requestUrl = request.url ?? ''
      tenant = String(request.headers['x-tenant'] ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'local-model' }] }))
    })
    const result = await testProviderConnection({
      protocol: 'openai-chat', baseUrl, apiKey: 'secret', headers: { 'X-Tenant': 'team-a' }
    })
    expect(result).toMatchObject({ ok: true, message: '连接成功，发现 1 个模型', models: [{ id: 'local-model', name: 'local-model', reasoning: false, input: ['text'], contextWindow: 128_000, maxTokens: 16_000, toolUse: true }] })
    expect(requestUrl).toBe('/v1/models')
    expect(tenant).toBe('team-a')
  })

  it('为不同协议生成正确认证头且允许自定义头覆盖', () => {
    expect(requestHeaders({ protocol: 'openai-responses', baseUrl: 'https://example.com/v1', apiKey: 'key' }).Authorization).toBe('Bearer key')
    expect(requestHeaders({ protocol: 'anthropic-messages', baseUrl: 'https://example.com', apiKey: 'key' })).toMatchObject({ 'x-api-key': 'key', 'anthropic-version': '2023-06-01' })
    expect(requestHeaders({ protocol: 'google-generative-ai', baseUrl: 'https://example.com/v1beta', apiKey: 'key' })['x-goog-api-key']).toBe('key')
    expect(requestHeaders({ protocol: 'openai-chat', baseUrl: 'https://example.com', apiKey: 'key', headers: { Authorization: 'Custom token' } }).Authorization).toBe('Custom token')
    expect(modelsUrl('https://api.anthropic.com', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/models')
    expect(modelsUrl('https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai')).toBe('https://generativelanguage.googleapis.com/v1beta/models')
  })

  it('解析 Anthropic 与 Google 模型列表', () => {
    expect(parseModelList('anthropic-messages', { data: [{ id: 'claude-sonnet', display_name: 'Claude Sonnet' }] })[0]).toMatchObject({ id: 'claude-sonnet', name: 'Claude Sonnet', reasoning: false, input: ['text', 'image'] })
    expect(parseModelList('google-generative-ai', { models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini Pro' }] })[0]).toMatchObject({ id: 'gemini-2.5-pro', name: 'Gemini Pro', reasoning: false, input: ['text', 'image'] })
  })

  it('将超时和无模型接口转换为可理解错误', async () => {
    const timeoutUrl = await serve(() => undefined)
    const timeout = await testProviderConnection({ protocol: 'openai-chat', baseUrl: timeoutUrl }, 20)
    expect(timeout).toMatchObject({ ok: false, message: '连接超时，请检查地址或网络', failedField: 'baseUrl' })

    const missingUrl = await serve((_request, response) => { response.statusCode = 404; response.end() })
    const missing = await testProviderConnection({ protocol: 'openai-chat', baseUrl: missingUrl })
    expect(missing).toMatchObject({ ok: false, message: '连接成功，但该地址没有模型列表接口；可以手动填写模型 ID', failedField: 'baseUrl' })
  })

  it('将认证错误归因到 API Key 字段', async () => {
    const baseUrl = await serve((_request, response) => { response.statusCode = 401; response.end() })
    const result = await testProviderConnection({ protocol: 'openai-chat', baseUrl, apiKey: 'invalid' })
    expect(result).toMatchObject({ ok: false, message: '认证失败，请检查 API Key 和请求头', failedField: 'apiKey' })
  })
})
