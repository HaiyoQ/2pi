import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'

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
})
