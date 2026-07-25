<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { Folder, FolderOpen, MessageSquare, PenLine, Settings, SlidersHorizontal } from 'lucide-vue-next'
import { useAgentStore } from '../stores/agent'

defineProps<{ view: 'task' | 'settings' }>()
const emit = defineEmits<{ selectView: [view: 'task' | 'settings'] }>()
const store = useAgentStore()

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

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-brand-row">
      <button class="wordmark" type="button" aria-label="2pi，新任务" @click="createTask">2pi</button>
    </div>

    <div class="sidebar-primary-actions">
      <button class="sidebar-command" type="button" @click="createTask">
        <PenLine :size="16" /><span>新任务</span>
      </button>
    </div>

    <div class="sidebar-project">
      <div class="sidebar-section-heading">
        <span>项目</span>
        <button class="icon-action" type="button" title="选择项目目录" @click="chooseWorkspace">
          <FolderOpen :size="15" />
        </button>
      </div>
      <button class="project-row" type="button" @click="chooseWorkspace">
        <Folder :size="15" />
        <span>
          <strong>{{ store.workspaceName }}</strong>
          <small>{{ store.settings?.workspace.path || '选择本地目录' }}</small>
        </span>
      </button>
    </div>

    <nav class="session-navigation" aria-label="会话记录">
      <div class="sidebar-section-heading"><span>记录</span></div>
      <button
        v-for="session in store.sessions"
        :key="session.id"
        type="button"
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
      <p v-if="store.initialized && !store.sessions.length" class="sidebar-empty">完成第一个任务后，记录会显示在这里。</p>
    </nav>

    <div class="sidebar-footer">
      <button :class="['sidebar-footer-row', { active: view === 'settings' }]" type="button" @click="emit('selectView', 'settings')">
        <Settings :size="16" /><span>设置</span>
      </button>
      <div class="sidebar-footer-row passive">
        <SlidersHorizontal :size="16" /><span>本地工作区</span>
      </div>
    </div>
  </aside>
</template>
