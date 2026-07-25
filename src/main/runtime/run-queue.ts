import type { QueueSnapshot, QueuedMessage, QueuedMessageMode } from '../../shared/contracts'

export interface QueueSession {
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  clearQueue(): { steering: string[]; followUp: string[] }
}

export class RunQueue {
  private items: QueuedMessage[] = []
  private rebuilding = false

  snapshot(): QueueSnapshot {
    return { items: this.items.map((item) => ({ ...item })) }
  }

  async enqueue(session: QueueSession, id: string, text: string, mode: QueuedMessageMode): Promise<QueueSnapshot> {
    if (this.items.some((item) => item.id === id)) return this.snapshot()
    const item: QueuedMessage = { id, text, mode, createdAt: new Date().toISOString() }
    this.items.push(item)
    try {
      await queueOnSession(session, item)
      return this.snapshot()
    } catch (error) {
      this.items = this.items.filter((entry) => entry.id !== id)
      throw error
    }
  }

  async remove(session: QueueSession, id: string): Promise<QueueSnapshot> {
    if (!this.items.some((item) => item.id === id)) return this.snapshot()
    const remaining = this.items.filter((item) => item.id !== id)
    this.rebuilding = true
    session.clearQueue()
    this.items = remaining
    try {
      const pending = remaining.map((item) => queueOnSession(session, item))
      await Promise.all(pending)
      return this.snapshot()
    } finally {
      this.rebuilding = false
    }
  }

  clear(session?: QueueSession): QueueSnapshot {
    this.rebuilding = true
    try {
      session?.clearQueue()
      this.items = []
      return this.snapshot()
    } finally {
      this.rebuilding = false
    }
  }

  reconcile(steeringCount: number, followUpCount: number): QueuedMessage[] {
    if (this.rebuilding) return []
    const consumed: QueuedMessage[] = []
    consumed.push(...this.consumeMode('steer', steeringCount))
    consumed.push(...this.consumeMode('follow-up', followUpCount))
    return consumed
  }

  private consumeMode(mode: QueuedMessageMode, remainingCount: number): QueuedMessage[] {
    const matching = this.items.filter((item) => item.mode === mode)
    const removeCount = Math.max(0, matching.length - remainingCount)
    if (!removeCount) return []
    const consumed = matching.slice(0, removeCount)
    const ids = new Set(consumed.map((item) => item.id))
    this.items = this.items.filter((item) => !ids.has(item.id))
    return consumed
  }
}

function queueOnSession(session: QueueSession, item: QueuedMessage): Promise<void> {
  return item.mode === 'steer' ? session.steer(item.text) : session.followUp(item.text)
}
