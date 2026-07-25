import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import {
  appendBranchRequest,
  BRANCH_REQUEST_ENTRY_TYPE,
  branchRequestLabel,
  createSessionTreeSnapshot,
  findBranchRequest,
  recoverBranchRequest
} from '../src/main/runtime/session-history'

describe('会话树', () => {
  it('保留原分支，并把新分支显示为所选节点的兄弟路径', () => {
    const manager = SessionManager.inMemory('C:\repo')
    manager.appendMessage({ role: 'user', content: '第一步', timestamp: Date.now() })
    const firstReply = manager.appendMessage(assistant('第一步完成'))
    manager.appendMessage({ role: 'user', content: '继续原方案', timestamp: Date.now() })
    const oldLeaf = manager.appendMessage(assistant('原方案完成'))

    const summaryId = manager.branchWithSummary(firstReply, '改走更小的修复路径')
    appendBranchRequest(manager, { requestId: 'branch-1', targetId: firstReply, status: 'complete', summaryEntryId: summaryId })

    const tree = createSessionTreeSnapshot(manager)
    expect(tree.nodes.map((node) => node.id)).toContain(oldLeaf)
    expect(tree.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: summaryId, parentId: firstReply, kind: 'branch-summary', active: true }),
      expect.objectContaining({ id: oldLeaf, kind: 'assistant', active: false })
    ]))
  })

  it('将请求标记和分支上下文写入 JSONL，重开后不重复创建目标', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), '2pi-tree-'))
    const manager = SessionManager.create('C:\repo', sessionDir)
    manager.appendMessage({ role: 'user', content: '保留这一步', timestamp: Date.now() })
    const firstReply = manager.appendMessage(assistant('保留的回复'))
    manager.appendMessage({ role: 'user', content: '丢弃这一步', timestamp: Date.now() })
    manager.appendMessage(assistant('丢弃的回复'))
    const summaryId = manager.branchWithSummary(firstReply, '原路径已验证，但改从保留节点继续')
    appendBranchRequest(manager, { requestId: 'stable-request', targetId: firstReply, status: 'complete', summaryEntryId: summaryId })

    const restored = SessionManager.open(manager.getSessionFile()!, sessionDir)
    const marker = findBranchRequest(restored, 'stable-request')
    const context = restored.buildSessionContext().messages

    expect(marker).toMatchObject({ requestId: 'stable-request', targetId: firstReply, status: 'complete', summaryEntryId: summaryId })
    expect(context.map((message) => JSON.stringify(message)).join('\n')).toContain('保留的回复')
    expect(context.map((message) => JSON.stringify(message)).join('\n')).not.toContain('丢弃的回复')
    if (!findBranchRequest(restored, 'stable-request')) {
      appendBranchRequest(restored, { requestId: 'stable-request', targetId: firstReply, status: 'complete' })
    }
    expect(restored.getEntries().filter((entry) => entry.type === 'custom' && entry.customType === BRANCH_REQUEST_ENTRY_TYPE)).toHaveLength(1)
  })

  it('可从 SDK 节点标签恢复已写入摘要但尚未完成标记的请求', () => {
    const manager = SessionManager.inMemory('C:\\repo')
    manager.appendMessage({ role: 'user', content: '起点', timestamp: Date.now() })
    const targetId = manager.appendMessage(assistant('起点回复'))
    manager.appendMessage({ role: 'user', content: '旧路径', timestamp: Date.now() })
    manager.appendMessage(assistant('旧路径回复'))
    appendBranchRequest(manager, { requestId: 'recoverable', targetId, status: 'pending' })
    const summaryId = manager.branchWithSummary(targetId, '恢复出来的分支摘要')
    manager.appendLabelChange(summaryId, branchRequestLabel('recoverable'))

    const marker = findBranchRequest(manager, 'recoverable')!
    expect(recoverBranchRequest(manager, marker)).toEqual({
      completed: true, summaryEntryId: summaryId, summary: '恢复出来的分支摘要'
    })
  })
})

function assistant(text: string) {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: 'openai-responses', provider: 'openai', model: 'gpt-5-mini',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now()
  } as never
}
