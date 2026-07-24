import { describe, expect, it, vi } from 'vitest'
import { ApprovalGate } from '../src/main/runtime/approval-gate'

describe('ApprovalGate', () => {
  it('重复审批保持幂等且只结算一次', async () => {
    const onRequest = vi.fn()
    const gate = new ApprovalGate(onRequest)
    const promise = gate.request({ sessionId: 's1', toolCallId: 't1', toolName: 'write', summary: '写入 a.txt' })
    const request = onRequest.mock.calls[0][0]
    const first = gate.decide(request.requestId, 'approved')
    const second = gate.decide(request.requestId, 'rejected')
    await expect(promise).resolves.toBe(true)
    expect(second).toEqual(first)
    expect(second.status).toBe('approved')
  })

  it('取消会话会拒绝所有未结算请求', async () => {
    const onRequest = vi.fn()
    const gate = new ApprovalGate(onRequest)
    const promise = gate.request({ sessionId: 's1', toolCallId: 't1', toolName: 'bash', summary: '运行命令' })
    gate.cancelSession('s1')
    await expect(promise).resolves.toBe(false)
    const request = onRequest.mock.calls[0][0]
    expect(gate.decide(request.requestId, 'approved').status).toBe('cancelled')
  })
})
