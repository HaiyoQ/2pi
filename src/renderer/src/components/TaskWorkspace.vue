<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  BrainCircuit,
  ChevronDown,
  CircleCheck,
  CircleX,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderSearch,
  GitBranch,
  GitCompare,
  LoaderCircle,
  Minimize2,
  RefreshCw,
  Search,
  Terminal,
  UserRound,
  X,
  Wrench
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type { GitChangedFile, GitDiffSection, SessionTreeNode, TimelineActivity, TimelineTurn } from '../../../shared/contracts'
import { useAgentStore } from '../stores/agent'
import PromptComposer from './PromptComposer.vue'

const emit = defineEmits<{ openSettings: [] }>()
const store = useAgentStore()
const scrollPane = ref<HTMLElement>()
const reviewMode = ref<'tree' | 'diff'>()
const selectedDiffPath = ref('')

const hasSetup = computed(() => Boolean(store.settings?.activeModel && store.settings.workspace.path))
const runStatus = computed(() => {
  if (store.activeRetry) return store.activeRetry.status === 'waiting' ? `等待重试 ${store.activeRetry.attempt}/${store.activeRetry.maxAttempts}` : `正在重试 ${store.activeRetry.attempt}/${store.activeRetry.maxAttempts}`
  if (store.activeThinking) return '正在思考'
  return '正在处理'
})
const selectedDiff = computed(() => store.gitDiff?.files.find((file) => file.path === selectedDiffPath.value) ?? store.gitDiff?.files[0])

watch(() => store.gitDiff?.files.map((file) => file.path).join('\0'), () => {
  if (!store.gitDiff?.files.some((file) => file.path === selectedDiffPath.value)) {
    selectedDiffPath.value = store.gitDiff?.files[0]?.path ?? ''
  }
})

watch(
  () => store.turns,
  async () => {
    await nextTick()
    if (scrollPane.value) scrollPane.value.scrollTop = scrollPane.value.scrollHeight
  },
  { deep: true }
)

function toolIcon(name: string): Component {
  const value = name.toLowerCase()
  if (value.includes('grep') || value.includes('search')) return Search
  if (value.includes('find') || value.includes('glob') || value.includes('ls')) return FolderSearch
  if (value.includes('bash') || value.includes('shell') || value.includes('command')) return Terminal
  if (value.includes('edit')) return FilePenLine
  if (value.includes('write')) return FilePlus2
  if (value.includes('read')) return FileText
  return Wrench
}

function toolActivities(turn: TimelineTurn): Extract<TimelineActivity, { type: 'tool' }>[] {
  return turn.activities.filter((item): item is Extract<TimelineActivity, { type: 'tool' }> => item.type === 'tool')
}

function statusActivities(turn: TimelineTurn): Exclude<TimelineActivity, { type: 'tool' }>[] {
  return turn.activities.filter((item): item is Exclude<TimelineActivity, { type: 'tool' }> => item.type !== 'tool')
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(value?: number): string {
  if (value === undefined) return '思考完成'
  return value < 1000 ? '思考完成' : `思考 ${Math.max(1, Math.round(value / 1000))} 秒`
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value)
}

async function compactContext(): Promise<void> {
  try {
    const result = await store.compactContext()
    const after = result.estimatedTokensAfter
    ElMessage.success(after === null ? '上下文已压缩' : `上下文已压缩至约 ${formatTokens(after)} tokens`)
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

async function chooseWorkspace(): Promise<void> {
  try {
    await store.chooseWorkspace()
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

async function openReview(mode: 'tree' | 'diff'): Promise<void> {
  reviewMode.value = mode
  try {
    if (mode === 'tree') await store.loadSessionTree()
    else await store.loadGitDiff()
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

async function branchFrom(node: SessionTreeNode): Promise<void> {
  try {
    const summary = await store.branchFromNode(node.id)
    ElMessage.success(summary ? '已创建分支并生成摘要' : '已从所选节点创建分支')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

function treeIcon(kind: SessionTreeNode['kind']): Component {
  if (kind === 'user') return UserRound
  if (kind === 'tool') return Wrench
  if (kind === 'compaction') return Minimize2
  if (kind === 'branch-summary') return GitBranch
  return BrainCircuit
}

function changeLabel(file: GitChangedFile): string {
  const labels = {
    added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', copied: '复制', untracked: '未跟踪', conflicted: '冲突'
  }
  return labels[file.status]
}

function sectionLabel(kind: GitDiffSection['kind']): string {
  return kind === 'staged' ? '已暂存' : kind === 'working' ? '工作区' : '未跟踪文件'
}

function relatedToolActivities(file: GitChangedFile): Extract<TimelineActivity, { type: 'tool' }>[] {
  const candidates = [file.path, file.oldPath].filter((value): value is string => Boolean(value)).map(normalizePath)
  return store.turns.flatMap((turn) => toolActivities(turn)).filter((activity) => {
    if (!activity.targetPath || (activity.toolName !== 'edit' && activity.toolName !== 'write')) return false
    const target = normalizePath(activity.targetPath)
    return candidates.some((path) => target === path || target.endsWith(`/${path}`))
  })
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase('zh-CN')
}

interface DiffLine {
  key: string
  text: string
  kind: 'context' | 'add' | 'delete' | 'hunk' | 'meta'
  oldLine?: number
  newLine?: number
}

function renderDiff(diff: string): DiffLine[] {
  let oldLine: number | undefined
  let newLine: number | undefined
  return diff.split('\n').map((text, index) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { key: `${index}:${text}`, text, kind: 'hunk' }
    }
    if (text.startsWith('+') && !text.startsWith('+++')) {
      const line = newLine
      if (newLine !== undefined) newLine += 1
      return { key: `${index}:${text}`, text, kind: 'add', newLine: line }
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      const line = oldLine
      if (oldLine !== undefined) oldLine += 1
      return { key: `${index}:${text}`, text, kind: 'delete', oldLine: line }
    }
    if (text.startsWith(' ') && oldLine !== undefined && newLine !== undefined) {
      const line = { key: `${index}:${text}`, text, kind: 'context' as const, oldLine, newLine }
      oldLine += 1
      newLine += 1
      return line
    }
    return { key: `${index}:${text}`, text, kind: 'meta' }
  })
}

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
</script>

<template>
  <section :class="['task-workspace', { 'review-open': reviewMode }]">
    <div class="task-surface">
    <header class="workspace-header">
      <div>
        <h1>{{ store.currentSession?.name || '新任务' }}</h1>
        <p>{{ store.settings?.workspace.path || '选择一个本地项目目录' }}</p>
      </div>
      <div class="workspace-statuses" aria-live="polite">
        <button v-if="store.currentSession" type="button" :class="['header-action', { active: reviewMode === 'tree' }]" title="查看会话树" :disabled="store.running" @click="openReview('tree')"><GitBranch :size="13" /><span>会话树</span></button>
        <button type="button" :class="['header-action', { active: reviewMode === 'diff' }]" title="审阅工作区改动" @click="openReview('diff')"><GitCompare :size="13" /><span>改动</span></button>
        <span v-if="store.contextUsage?.percent !== null && store.contextUsage?.percent !== undefined" class="context-status" :title="`${store.contextUsage.tokens ?? 0} / ${store.contextUsage.contextWindow} tokens`">上下文 {{ Math.round(store.contextUsage.percent) }}%</span>
        <button v-if="store.currentSession && store.turns.length" type="button" class="header-action" title="压缩会话上下文" :disabled="store.running || store.transitioning" @click="compactContext"><Minimize2 :size="13" /><span>{{ store.compacting ? '压缩中' : '压缩' }}</span></button>
        <span v-if="store.running" class="run-status"><LoaderCircle :size="14" />{{ runStatus }}</span>
      </div>
    </header>

    <div ref="scrollPane" class="transcript-scroll">
      <div class="transcript-column">
        <section v-if="store.initialized && !store.turns.length" class="task-empty-state">
          <h2>{{ hasSetup ? '开始一个任务' : '完成本地配置' }}</h2>
          <p v-if="hasSetup">描述需要读取、修改或验证的内容，LOOP 会在当前项目中完成任务。</p>
          <p v-else>选择项目目录并配置模型后，即可在这个工作区直接开始。</p>
          <div v-if="!hasSetup" class="empty-actions">
            <button type="button" class="secondary-command" @click="chooseWorkspace">选择项目</button>
            <button type="button" class="primary-command" @click="emit('openSettings')">配置模型</button>
          </div>
        </section>

        <article v-for="turn in store.turns" :key="turn.id" class="transcript-turn">
          <div class="user-bubble">
            <div v-if="turn.user.text">{{ turn.user.text }}</div>
            <div v-if="turn.user.images.length" class="message-images">
              <img v-for="(image, index) in turn.user.images" :key="`${turn.user.id}:${index}`" :src="`data:${image.mimeType};base64,${image.data}`" alt="用户发送的图片" />
            </div>
          </div>

          <div class="assistant-turn">
            <div v-for="item in statusActivities(turn)" :key="item.id" :class="['run-activity-row', item.type, item.status]">
              <template v-if="item.type === 'thinking'">
                <LoaderCircle v-if="item.status === 'running'" :size="14" />
                <BrainCircuit v-else :size="14" />
                <span>{{ item.status === 'running' ? '正在思考' : formatDuration(item.durationMs) }}</span>
              </template>
              <template v-else>
                <LoaderCircle v-if="item.status === 'waiting' || item.status === 'running'" :size="14" />
                <CircleCheck v-else-if="item.status === 'succeeded'" :size="14" />
                <CircleX v-else :size="14" />
                <span><strong>{{ item.status === 'waiting' ? `将在 ${Math.ceil(item.delayMs / 1000)} 秒后重试` : item.status === 'running' ? `正在进行第 ${item.attempt} 次重试` : item.status === 'succeeded' ? '重试成功' : '重试失败' }}</strong><small>{{ item.message }}</small></span>
                <RefreshCw :size="13" class="activity-kind" />
              </template>
            </div>

            <details v-if="toolActivities(turn).length" class="tool-chain" open>
              <summary>
                <Wrench :size="15" />
                <strong>工具调用</strong>
                <span>{{ toolActivities(turn).length }} 项</span>
                <ChevronDown :size="14" class="disclosure-icon" />
              </summary>
              <div class="tool-chain-items">
                <div v-for="item in toolActivities(turn)" :key="item.id" :class="['tool-chain-row', item.status]">
                  <component :is="toolIcon(item.toolName)" :size="15" class="tool-kind-icon" />
                  <span><strong>{{ item.toolName }}</strong><small>{{ item.summary }}</small></span>
                  <LoaderCircle v-if="item.status === 'running'" :size="14" class="spin" />
                  <CircleX v-else-if="item.status === 'error'" :size="14" />
                  <CircleCheck v-else :size="14" />
                </div>
              </div>
            </details>

            <div v-if="turn.assistant?.text" class="assistant-copy">{{ turn.assistant.text }}</div>
            <div v-else-if="turn.state === 'running' && !turn.activities.length" class="thinking-row"><LoaderCircle :size="15" />正在处理任务</div>

            <div v-if="turn.error" class="run-error" role="alert">
              <CircleX :size="16" /><span><strong>任务失败</strong>{{ turn.error }}</span>
            </div>

            <footer v-if="turn.state !== 'running' || turn.usage.total" class="turn-meta">
              <span>{{ turn.state === 'complete' ? '已完成' : turn.state === 'failed' ? '失败' : turn.state === 'cancelled' ? '已中止' : '处理中' }}</span>
              <span v-if="turn.usage.total">{{ formatTokens(turn.usage.total) }} tokens</span>
              <time>{{ formatTime(turn.assistant?.timestamp || turn.user.timestamp) }}</time>
            </footer>
          </div>
        </article>

        <div v-if="store.error && (store.running || !store.turns.length)" class="run-error" role="alert">
          <CircleX :size="16" /><span><strong>操作失败</strong>{{ store.error }}</span>
        </div>
      </div>
    </div>

    <PromptComposer @open-settings="emit('openSettings')" />
    </div>

    <aside v-if="reviewMode" class="review-pane" aria-label="审阅面板">
      <header class="review-header">
        <div>
          <strong>{{ reviewMode === 'tree' ? '会话树' : '工作区改动' }}</strong>
          <small>{{ reviewMode === 'tree' ? `${store.sessionTree?.nodes.length ?? 0} 个历史节点` : store.gitDiff?.message || '读取 Git 状态' }}</small>
        </div>
        <button class="icon-action" type="button" title="关闭审阅面板" aria-label="关闭审阅面板" @click="reviewMode = undefined"><X :size="15" /></button>
      </header>
      <nav class="review-tabs" aria-label="审阅类型">
        <button :class="{ active: reviewMode === 'tree' }" type="button" @click="openReview('tree')"><GitBranch :size="13" />会话树</button>
        <button :class="{ active: reviewMode === 'diff' }" type="button" @click="openReview('diff')"><GitCompare :size="13" />改动审阅</button>
        <button class="review-refresh" type="button" title="刷新" aria-label="刷新审阅内容" :disabled="store.diffLoading || store.branchSubmitting" @click="openReview(reviewMode)"><RefreshCw :size="13" :class="{ spin: store.diffLoading || store.branchSubmitting }" /></button>
      </nav>

      <div v-if="reviewMode === 'tree'" class="session-tree-pane">
        <div v-if="store.sessionTree?.nodes.length" class="session-tree-list">
          <article v-for="node in store.sessionTree.nodes" :key="node.id" :class="['session-tree-node', { active: node.active }]" :style="{ '--tree-depth': Math.min(node.depth, 6) }">
            <component :is="treeIcon(node.kind)" :size="14" />
            <span>
              <strong>{{ node.title }}</strong>
              <small>{{ node.preview }}</small>
            </span>
            <span v-if="node.active" class="tree-current">当前路径</span>
            <button v-if="node.branchable && !node.active" type="button" title="从此节点创建分支" :disabled="store.running || store.transitioning" @click="branchFrom(node)"><GitBranch :size="12" />分支</button>
          </article>
        </div>
        <div v-else class="review-empty"><GitBranch :size="22" /><strong>还没有可分支的历史</strong><span>完成一轮对话后，会话节点会显示在这里。</span></div>
        <p class="review-note">分支会保留原历史，并将原生分支摘要写入本地会话 JSONL。</p>
      </div>

      <div v-else class="diff-review-pane">
        <div v-if="store.diffLoading && !store.gitDiff" class="review-empty"><LoaderCircle :size="22" class="spin" /><strong>正在读取改动</strong></div>
        <div v-else-if="store.gitDiff?.state !== 'ready' || !store.gitDiff.files.length" class="review-empty">
          <GitCompare :size="22" />
          <strong>{{ store.gitDiff?.state === 'not-git' ? '尚未初始化 Git' : store.gitDiff?.state === 'git-unavailable' ? '未找到 Git' : '没有可审阅的改动' }}</strong>
          <span>{{ store.gitDiff?.message || '当前工作目录没有未提交改动。' }}</span>
        </div>
        <div v-else class="diff-layout">
          <nav class="changed-file-list" aria-label="改动文件">
            <button v-for="file in store.gitDiff.files" :key="file.path" :class="{ active: selectedDiff?.path === file.path }" type="button" @click="selectedDiffPath = file.path">
              <FileText :size="13" />
              <span><strong>{{ file.path.split(/[\\/]/).at(-1) }}</strong><small>{{ file.path }}</small></span>
              <em>{{ changeLabel(file) }}</em>
              <code><b>+{{ file.additions }}</b> / <i>-{{ file.deletions }}</i></code>
            </button>
          </nav>
          <section v-if="selectedDiff" class="selected-diff">
            <header>
              <span><strong>{{ selectedDiff.path }}</strong><small v-if="selectedDiff.oldPath">原路径：{{ selectedDiff.oldPath }}</small></span>
              <span>{{ changeLabel(selectedDiff) }} · {{ selectedDiff.staged ? '含已暂存' : '未暂存' }}</span>
            </header>
            <div v-if="relatedToolActivities(selectedDiff).length" class="diff-tool-links">
              <Wrench :size="13" /><span>关联 {{ relatedToolActivities(selectedDiff).length }} 次文件修改工具</span>
            </div>
            <div class="diff-scroll">
              <section v-for="section in selectedDiff.sections" :key="section.kind" class="diff-section">
                <h3>{{ sectionLabel(section.kind) }}<span v-if="section.truncated">内容已截断</span></h3>
                <div v-if="selectedDiff.binary" class="binary-diff">二进制文件已变化，不显示文本行。</div>
                <div v-else class="diff-lines">
                  <div v-for="line in renderDiff(section.diff)" :key="line.key" :class="['diff-line', line.kind]">
                    <span>{{ line.oldLine }}</span><span>{{ line.newLine }}</span><code>{{ line.text || ' ' }}</code>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
        <p v-if="store.gitDiff?.truncated" class="review-note">改动过多，当前只展示部分文件或内容。</p>
      </div>
    </aside>
  </section>
</template>
