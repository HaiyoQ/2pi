import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { buildSessionTimeline, RETRY_ENTRY_TYPE } from '../src/main/runtime/session-timeline'

describe('会话持久化', () => {
  it('可从 JSONL 文件恢复消息', () => {
    const run = async () => {
      const sessionDir = await mkdtemp(join(tmpdir(), '2pi-session-'))
      const manager = SessionManager.create('C:\\中文 项目', sessionDir)
      manager.appendMessage({ role: 'user', content: '修改 README', timestamp: Date.now() })
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: '已完成' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-5-mini',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now()
      } as never)
      const file = manager.getSessionFile()
      expect(file).toBeTruthy()
      const restored = SessionManager.open(file!, sessionDir)
      expect(restored.getEntries()).toHaveLength(2)
      expect(restored.buildSessionContext().messages[0]).toMatchObject({ role: 'user', content: '修改 README' })
    }
    return run()
  })

  it('从当前分支恢复工具、重试、用量和错误，同时丢弃 thinking 原文', () => {
    const manager = SessionManager.inMemory('C:\\repo')
    manager.appendMessage({ role: 'user', content: '运行检查', timestamp: Date.now() })
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '绝不能进入 renderer 的原始思考' },
        { type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'npm test' } }
      ],
      api: 'openai-responses', provider: 'openai', model: 'gpt-5-mini',
      usage: usage(10, 2), stopReason: 'toolUse', timestamp: Date.now()
    } as never)
    manager.appendMessage({
      role: 'toolResult', toolCallId: 'tool-1', toolName: 'bash',
      content: [{ type: 'text', text: '全部通过' }], isError: false, timestamp: Date.now()
    } as never)
    manager.appendCustomEntry(RETRY_ENTRY_TYPE, {
      runId: 'run-1', attempt: 1, maxAttempts: 3, delayMs: 1000, message: '服务暂时不可用', status: 'succeeded'
    })
    manager.appendMessage({
      role: 'assistant', content: [{ type: 'text', text: '检查完成' }],
      api: 'openai-responses', provider: 'openai', model: 'gpt-5-mini',
      usage: usage(5, 3), stopReason: 'stop', timestamp: Date.now()
    } as never)

    const turns = buildSessionTimeline(manager)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ state: 'complete', assistant: { text: '检查完成' }, usage: { input: 15, output: 5, total: 20 } })
    expect(turns[0].activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thinking', status: 'complete' }),
      expect.objectContaining({ type: 'tool', toolCallId: 'tool-1', status: 'complete', summary: '全部通过' }),
      expect.objectContaining({ type: 'retry', attempt: 1, status: 'succeeded' })
    ]))
    expect(JSON.stringify(turns)).not.toContain('绝不能进入 renderer')
  })

  it('恢复 edit/write 的目标路径用于关联改动文件', () => {
    const manager = SessionManager.inMemory('C:\\repo')
    manager.appendMessage({ role: 'user', content: '修改文件', timestamp: Date.now() })
    manager.appendMessage({
      role: 'assistant', content: [{ type: 'toolCall', id: 'tool-edit', name: 'edit', arguments: { path: 'src/main/ipc.ts' } }],
      api: 'openai-responses', provider: 'openai', model: 'gpt-5-mini', usage: usage(3, 1), stopReason: 'toolUse', timestamp: Date.now()
    } as never)

    expect(buildSessionTimeline(manager)[0].activities).toContainEqual(expect.objectContaining({
      type: 'tool', toolCallId: 'tool-edit', targetPath: 'src/main/ipc.ts'
    }))
  })

  it('将没有后续回复的工具错误恢复为失败而不是取消', () => {
    const manager = SessionManager.inMemory('C:\\repo')
    manager.appendMessage({ role: 'user', content: '运行失败命令', timestamp: Date.now() })
    manager.appendMessage({
      role: 'assistant', content: [{ type: 'toolCall', id: 'tool-fail', name: 'bash', arguments: { command: 'exit 1' } }],
      api: 'openai-responses', provider: 'openai', model: 'gpt-5-mini', usage: usage(3, 1), stopReason: 'toolUse', timestamp: Date.now()
    } as never)
    manager.appendMessage({
      role: 'toolResult', toolCallId: 'tool-fail', toolName: 'bash', content: [{ type: 'text', text: '退出码 1' }],
      isError: true, timestamp: Date.now()
    } as never)

    expect(buildSessionTimeline(manager)[0]).toMatchObject({ state: 'failed', error: '退出码 1' })
  })

  it('恢复用户消息中的图片内容', () => {
    const manager = SessionManager.inMemory('C:\\repo')
    const data = Buffer.from('image').toString('base64')
    manager.appendMessage({ role: 'user', content: [{ type: 'text', text: '检查这张图' }, { type: 'image', data, mimeType: 'image/png' }], timestamp: Date.now() } as never)
    expect(buildSessionTimeline(manager)[0]?.user).toMatchObject({ text: '检查这张图', images: [{ data, mimeType: 'image/png' }] })
  })
})

function usage(input: number, output: number) {
  return {
    input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}
