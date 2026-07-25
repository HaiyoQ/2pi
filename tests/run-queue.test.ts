import { describe, expect, it, vi } from 'vitest'
import { RunQueue, type QueueSession } from '../src/main/runtime/run-queue'

function createSession(): QueueSession & { steering: string[]; followUps: string[] } {
  const session = {
    steering: [] as string[],
    followUps: [] as string[],
    steer: vi.fn(async (text: string) => { session.steering.push(text) }),
    followUp: vi.fn(async (text: string) => { session.followUps.push(text) }),
    clearQueue: vi.fn(() => {
      const value = { steering: [...session.steering], followUp: [...session.followUps] }
      session.steering = []
      session.followUps = []
      return value
    })
  }
  return session
}

describe('RunQueue', () => {
  it('deduplicates client request ids and keeps both SDK queue modes ordered', async () => {
    const queue = new RunQueue()
    const session = createSession()

    await queue.enqueue(session, 'message-1', '先检查测试', 'steer')
    await queue.enqueue(session, 'message-1', '不应重复', 'steer')
    await queue.enqueue(session, 'message-2', '完成后总结', 'follow-up')

    expect(session.steering).toEqual(['先检查测试'])
    expect(session.followUps).toEqual(['完成后总结'])
    expect(queue.snapshot().items.map((item) => item.id)).toEqual(['message-1', 'message-2'])
  })

  it('reconciles consumed messages and removes a queued item idempotently', async () => {
    const queue = new RunQueue()
    const session = createSession()
    await queue.enqueue(session, 'message-1', '第一条', 'steer')
    await queue.enqueue(session, 'message-2', '第二条', 'steer')
    await queue.enqueue(session, 'message-3', '第三条', 'follow-up')

    session.steering.shift()
    expect(queue.reconcile(1, 1).map((item) => item.id)).toEqual(['message-1'])

    await queue.remove(session, 'message-2')
    await queue.remove(session, 'message-2')

    expect(queue.snapshot().items.map((item) => item.id)).toEqual(['message-3'])
    expect(session.steering).toEqual([])
    expect(session.followUps).toEqual(['第三条'])
  })

  it('clears all pending interactions together', async () => {
    const queue = new RunQueue()
    const session = createSession()
    await queue.enqueue(session, 'message-1', '立即引导', 'steer')
    await queue.enqueue(session, 'message-2', '排队继续', 'follow-up')

    expect(queue.clear(session)).toEqual({ items: [] })
    expect(session.steering).toEqual([])
    expect(session.followUps).toEqual([])
  })
})
