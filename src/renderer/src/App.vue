<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { LoaderCircle } from 'lucide-vue-next'
import AppSidebar from './components/AppSidebar.vue'
import SettingsView from './components/SettingsView.vue'
import TaskWorkspace from './components/TaskWorkspace.vue'
import { useAgentStore } from './stores/agent'

const store = useAgentStore()
const view = ref<'task' | 'settings'>('task')

onMounted(async () => {
  try {
    await store.initialize()
  } catch (error) {
    ElMessage.error(errorText(error))
  }
})

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar :view="view" @select-view="view = $event" />
    <main class="app-main">
      <div v-if="!store.initialized" class="app-loading"><LoaderCircle :size="18" />正在加载本地工作区</div>
      <SettingsView v-else-if="view === 'settings'" @close="view = 'task'" />
      <TaskWorkspace v-else @open-settings="view = 'settings'" />
    </main>
  </div>
</template>
