import { randomUUID } from 'node:crypto'
import type { ToolApprovalRequest } from '../../shared/contracts'

interface PendingApproval {
  request: ToolApprovalRequest
  resolve: (approved: boolean) => void
}

export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly settled = new Map<string, ToolApprovalRequest>()

  constructor(private readonly onRequest: (request: ToolApprovalRequest) => void) {}

  request(input: Omit<ToolApprovalRequest, 'requestId' | 'status'>): Promise<boolean> {
    const request: ToolApprovalRequest = { ...input, requestId: randomUUID(), status: 'pending' }
    return new Promise<boolean>((resolve) => {
      this.pending.set(request.requestId, { request, resolve })
      this.onRequest(request)
    })
  }

  decide(requestId: string, decision: 'approved' | 'rejected'): ToolApprovalRequest {
    const previous = this.settled.get(requestId)
    if (previous) return previous
    const entry = this.pending.get(requestId)
    if (!entry) throw new Error('审批请求不存在或已失效')
    const request = { ...entry.request, status: decision } satisfies ToolApprovalRequest
    this.pending.delete(requestId)
    this.settled.set(requestId, request)
    entry.resolve(decision === 'approved')
    return request
  }

  cancelSession(sessionId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.request.sessionId !== sessionId) continue
      const request = { ...entry.request, status: 'cancelled' as const }
      this.pending.delete(id)
      this.settled.set(id, request)
      entry.resolve(false)
    }
  }
}
