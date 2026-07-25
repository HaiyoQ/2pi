<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, FolderOpen, MessageSquare, PenLine, Search, Settings } from 'lucide-vue-next'
import { useAgentStore } from '../stores/agent'

defineProps<{ view: 'task' | 'settings' }>()
const emit = defineEmits<{ selectView: [view: 'task' | 'settings'] }>()
const store = useAgentStore()
const historyQuery = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

const sessionGroups = computed(() => {
  const groups = new Map<string, typeof store.sessions>()
  for (const session of store.sessions) {
    const items = groups.get(session.workspacePath) ?? []
    items.push(session)
    groups.set(session.workspacePath, items)
  }
  return [...groups].map(([path, sessions]) => ({ path, name: projectName(path), sessions }))
})

watch(historyQuery, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void store.searchHistory(value).catch((error) => ElMessage.error(errorText(error))), 180)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

async function createTask(): Promise<void> {
  try {
    await store.createSession()
    emit('selectView', 'task')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

async function openSession(id: string): Promise<void> {
  try {
    await store.openSession(id)
    emit('selectView', 'task')
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

async function renameSession(id: string, currentName: string): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('输入新的会话名称', '重命名会话', {
      inputValue: currentName,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputPattern: /\S/,
      inputErrorMessage: '会话名称不能为空'
    })
    await store.renameHistorySession(id, result.value.trim())
    if (historyQuery.value) await store.searchHistory(historyQuery.value)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(errorText(error))
  }
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path || '未分类项目'
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-primary-actions">
      <button class="sidebar-command" type="button" aria-label="新任务" title="新任务" :disabled="store.running || store.transitioning" @click="createTask">
        <PenLine :size="16" /><span>新任务</span>
      </button>
    </div>

    <div class="sidebar-project">
      <div class="sidebar-section-heading">
        <span>项目</span>
        <button class="icon-action" type="button" title="选择项目目录" :disabled="store.running || store.transitioning" @click="chooseWorkspace">
          <FolderOpen :size="15" />
        </button>
      </div>
      <button class="project-row" type="button" aria-label="选择项目目录" title="选择项目目录" :disabled="store.running || store.transitioning" @click="chooseWorkspace">
        <Folder :size="15" />
        <span>
          <strong>{{ store.workspaceName }}</strong>
          <small>{{ store.settings?.workspace.path || '选择本地目录' }}</small>
        </span>
      </button>
    </div>

    <nav class="session-navigation" aria-label="会话记录">
      <div class="sidebar-section-heading"><span>记录</span></div>
      <label class="session-search">
        <Search :size="13" />
        <input v-model="historyQuery" type="search" placeholder="搜索历史" aria-label="搜索会话历史" />
      </label>
      <section v-for="group in sessionGroups" :key="group.path" class="session-group">
        <h2>{{ group.name }}</h2>
        <div v-for="session in group.sessions" :key="session.id" class="session-row-shell">
          <button
            type="button"
            :aria-label="`打开会话：${session.name || '未命名任务'}`"
            :title="session.name || '未命名任务'"
            :disabled="store.running || store.transitioning"
            :class="['session-row', { active: view === 'task' && session.id === store.currentSession?.id }]"
            @click="openSession(session.id)"
          >
            <MessageSquare :size="14" class="session-icon" />
            <span>
              <strong>{{ session.name || '未命名任务' }}</strong>
              <small>{{ session.messageCount }} 条消息</small>
            </span>
            <time>{{ formatUpdatedAt(session.updatedAt) }}</time>
          </button>
          <button class="session-rename" type="button" title="重命名会话" aria-label="重命名会话" :disabled="store.running || store.transitioning" @click="renameSession(session.id, session.name)">
            <PenLine :size="12" />
          </button>
        </div>
      </section>
      <p v-if="store.initialized && !store.sessions.length" class="sidebar-empty">完成第一个任务后，记录会显示在这里。</p>
    </nav>

    <div class="sidebar-footer">
      <button :class="['sidebar-footer-row', { active: view === 'settings' }]" type="button" aria-label="设置" title="设置" @click="emit('selectView', 'settings')">
        <Settings :size="16" /><span>设置</span>
      </button>
    </div>
  </aside>
</template>
