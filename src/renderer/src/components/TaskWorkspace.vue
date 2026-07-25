<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderSearch,
  LoaderCircle,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
  X
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { useAgentStore } from '../stores/agent'
import PromptComposer from './PromptComposer.vue'

const emit = defineEmits<{ openSettings: [] }>()
const store = useAgentStore()
const scrollPane = ref<HTMLElement>()

const pendingApprovals = computed(() => store.approvals.filter((item) => item.status === 'pending'))
const hasSetup = computed(() => Boolean(store.settings?.activeModel && store.settings.workspace.path))

watch(
  () => [store.messages.map((item) => item.text).join(''), store.toolEvents.length, store.approvals.length],
  async () => {
    await nextTick()
    if (scrollPane.value) scrollPane.value.scrollTop = scrollPane.value.scrollHeight
  }
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

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section class="task-workspace">
    <header class="workspace-header">
      <div>
        <h1>{{ store.currentSession?.name || '新任务' }}</h1>
        <p>{{ store.settings?.workspace.path || '选择一个本地项目目录' }}</p>
      </div>
      <span v-if="store.running" class="run-status"><LoaderCircle :size="14" />正在处理</span>
    </header>

    <div ref="scrollPane" class="transcript-scroll">
      <div class="transcript-column">
        <section v-if="store.initialized && !store.messages.length" class="task-empty-state">
          <h2>{{ hasSetup ? '开始一个任务' : '完成本地配置' }}</h2>
          <p v-if="hasSetup">描述需要读取、修改或验证的内容，2pi 会在当前项目中完成任务。</p>
          <p v-else>选择项目目录并配置模型后，即可在这个工作区直接开始。</p>
          <div v-if="!hasSetup" class="empty-actions">
            <button type="button" class="secondary-command" @click="store.chooseWorkspace">选择项目</button>
            <button type="button" class="primary-command" @click="emit('openSettings')">配置模型</button>
          </div>
        </section>

        <article v-for="message in store.messages" :key="message.id" :class="['transcript-message', message.role]">
          <div v-if="message.role === 'user'" class="user-bubble">{{ message.text }}</div>
          <div v-else class="assistant-turn">
            <div v-if="message.text" class="assistant-copy">{{ message.text }}</div>
            <div v-else-if="store.running" class="thinking-row"><LoaderCircle :size="15" />正在处理任务</div>
            <time v-if="message.text">{{ formatTime(message.timestamp) }}</time>
          </div>
        </article>

        <details v-if="store.toolEvents.length || pendingApprovals.length" class="tool-chain" open>
          <summary>
            <Wrench :size="15" />
            <strong>工具调用</strong>
            <span>{{ store.toolEvents.length + pendingApprovals.length }} 项</span>
            <ChevronDown :size="14" class="disclosure-icon" />
          </summary>
          <div class="tool-chain-items">
            <div v-for="item in store.toolEvents" :key="item.id" :class="['tool-chain-row', item.status]">
              <component :is="toolIcon(item.toolName)" :size="15" class="tool-kind-icon" />
              <span><strong>{{ item.toolName }}</strong><small>{{ item.summary }}</small></span>
              <LoaderCircle v-if="item.status === 'running'" :size="14" class="spin" />
              <CircleX v-else-if="item.status === 'error'" :size="14" />
              <CircleCheck v-else :size="14" />
            </div>

            <div v-for="request in pendingApprovals" :key="request.requestId" class="approval-row">
              <ShieldCheck :size="15" class="tool-kind-icon" />
              <span><strong>{{ request.toolName }} 需要批准</strong><small>{{ request.summary }}</small></span>
              <div class="approval-controls">
                <button type="button" title="拒绝" @click="store.decide(request, 'rejected')"><X :size="14" /></button>
                <button type="button" class="approve" title="批准" @click="store.decide(request, 'approved')"><Check :size="14" /></button>
              </div>
            </div>
          </div>
        </details>

        <div v-if="store.error" class="run-error" role="alert">
          <CircleX :size="16" /><span><strong>任务失败</strong>{{ store.error }}</span>
        </div>
      </div>
    </div>

    <PromptComposer @open-settings="emit('openSettings')" />
  </section>
</template>
