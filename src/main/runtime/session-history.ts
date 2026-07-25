import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionTreeNode, SessionTreeNodeKind, SessionTreeSnapshot } from '../../shared/contracts'

export const BRANCH_REQUEST_ENTRY_TYPE = '2pi.branch-request'

export interface BranchRequestMarker {
  requestId: string
  targetId: string
  status: 'pending' | 'complete'
  summaryEntryId?: string
  timestamp?: string
}

export const branchRequestLabel = (requestId: string): string => `2pi-branch:${requestId}`

export function createSessionTreeSnapshot(manager: SessionManager): SessionTreeSnapshot {
  const entries = manager.getEntries()
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const visible = entries.filter(isVisibleEntry)
  const visibleIds = new Set(visible.map((entry) => entry.id))
  const activeId = [...manager.getBranch()].reverse().find((entry) => visibleIds.has(entry.id))?.id
  const children = new Map<string | undefined, SessionEntry[]>()

  for (const entry of visible) {
    const parentId = visibleParentId(entry, byId, visibleIds)
    const siblings = children.get(parentId) ?? []
    siblings.push(entry)
    children.set(parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const nodes: SessionTreeNode[] = []
  const visit = (entry: SessionEntry, depth: number): void => {
    const parentId = visibleParentId(entry, byId, visibleIds)
    nodes.push(toTreeNode(entry, parentId, depth, entry.id === activeId))
    const descendants = children.get(entry.id) ?? []
    const childDepth = descendants.length > 1 ? depth + 1 : depth
    for (const child of descendants) visit(child, childDepth)
  }
  for (const root of children.get(undefined) ?? []) visit(root, 0)

  return {
    sessionId: manager.getSessionId(),
    leafId: manager.getLeafId() ?? undefined,
    nodes
  }
}

export function findBranchRequest(manager: SessionManager, requestId: string): BranchRequestMarker | undefined {
  let found: BranchRequestMarker | undefined
  for (const entry of manager.getEntries()) {
    if (entry.type !== 'custom' || entry.customType !== BRANCH_REQUEST_ENTRY_TYPE || !isRecord(entry.data)) continue
    if (entry.data.requestId === requestId && typeof entry.data.targetId === 'string') {
      found = {
        requestId,
        targetId: entry.data.targetId,
        status: entry.data.status === 'pending' ? 'pending' : 'complete',
        timestamp: entry.timestamp,
        summaryEntryId: typeof entry.data.summaryEntryId === 'string' ? entry.data.summaryEntryId : undefined
      }
    }
  }
  return found
}

export function appendBranchRequest(manager: SessionManager, marker: BranchRequestMarker): void {
  manager.appendCustomEntry(BRANCH_REQUEST_ENTRY_TYPE, marker)
}

export function recoverBranchRequest(manager: SessionManager, marker: BranchRequestMarker): { completed: boolean; summaryEntryId?: string; summary?: string } {
  const entries = manager.getEntries()
  const label = entries.find((entry) => entry.type === 'label' && entry.label === branchRequestLabel(marker.requestId))
  if (label?.type === 'label') {
    const target = manager.getEntry(label.targetId)
    return target?.type === 'branch_summary'
      ? { completed: true, summaryEntryId: target.id, summary: target.summary }
      : { completed: true }
  }
  return { completed: false }
}

function isVisibleEntry(entry: SessionEntry): boolean {
  return entry.type === 'message' || entry.type === 'compaction' || entry.type === 'branch_summary'
}

function visibleParentId(entry: SessionEntry, byId: Map<string, SessionEntry>, visibleIds: Set<string>): string | undefined {
  let parentId = entry.parentId ?? undefined
  while (parentId && !visibleIds.has(parentId)) parentId = byId.get(parentId)?.parentId ?? undefined
  return parentId
}

function toTreeNode(entry: SessionEntry, parentId: string | undefined, depth: number, active: boolean): SessionTreeNode {
  const value = describeEntry(entry)
  return {
    id: entry.id,
    parentId,
    depth,
    kind: value.kind,
    title: value.title,
    preview: value.preview,
    timestamp: entry.timestamp,
    active,
    branchable: value.kind !== 'user'
  }
}

function describeEntry(entry: SessionEntry): { kind: SessionTreeNodeKind; title: string; preview: string } {
  if (entry.type === 'compaction') return { kind: 'compaction', title: '上下文压缩', preview: entry.summary.slice(0, 180) }
  if (entry.type === 'branch_summary') return { kind: 'branch-summary', title: '分支摘要', preview: entry.summary.slice(0, 180) }
  if (entry.type !== 'message') return { kind: 'assistant', title: '会话节点', preview: '' }

  const message = entry.message as unknown as Record<string, unknown>
  const preview = messageText(message.content).slice(0, 180)
  if (message.role === 'user') return { kind: 'user', title: '你的消息', preview: preview || '空消息' }
  if (message.role === 'toolResult') {
    const toolName = typeof message.toolName === 'string' ? message.toolName : '工具'
    return { kind: 'tool', title: `${toolName} 结果`, preview: preview || '工具执行结果' }
  }
  const toolNames = Array.isArray(message.content)
    ? message.content.flatMap((part) => isRecord(part) && part.type === 'toolCall' && typeof part.name === 'string' ? [part.name] : [])
    : []
  return {
    kind: 'assistant',
    title: toolNames.length ? `Agent · ${toolNames.join('、')}` : 'Agent 回复',
    preview: preview || (toolNames.length ? '准备调用工具' : '无文本回复')
  }
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
