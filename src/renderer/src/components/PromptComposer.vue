<script setup lang="ts">
import { computed, ref } from 'vue'
import { Folder, Send, Settings2, ShieldCheck, Square } from 'lucide-vue-next'
import { useAgentStore } from '../stores/agent'

const emit = defineEmits<{ openSettings: [] }>()
const store = useAgentStore()
const prompt = ref('')

const activeModelLabel = computed(() => {
  const active = store.settings?.activeModel
  if (!active) return '选择模型'
  return store.models.find((model) => model.providerId === active.providerId && model.modelId === active.modelId)?.label || active.modelId
})

const canSend = computed(() => Boolean(
  prompt.value.trim()
  && store.settings?.activeModel
  && store.settings.workspace.path
  && !store.running
))

async function submit(): Promise<void> {
  const value = prompt.value.trim()
  if (!value || !canSend.value) return
  if (await store.send(value)) prompt.value = ''
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
}
</script>

<template>
  <footer class="composer-zone">
    <div class="composer-shell">
      <textarea
        v-model="prompt"
        rows="2"
        :placeholder="store.settings?.activeModel ? '向 2pi 描述任务' : '先配置模型，再开始任务'"
        :disabled="store.running"
        @keydown="handleKeydown"
      />
      <div class="composer-contracts">
        <button type="button" class="contract-control" title="选择项目目录" @click="store.chooseWorkspace">
          <Folder :size="14" /><span>{{ store.workspaceName }}</span>
        </button>
        <button type="button" class="contract-control" title="打开模型设置" @click="emit('openSettings')">
          <Settings2 :size="14" /><span>{{ activeModelLabel }}</span>
        </button>
        <span class="contract-control passive" title="写入和命令仍需逐次批准">
          <ShieldCheck :size="14" /><span>受控执行</span>
        </span>
        <button v-if="store.running" type="button" class="send-control stop" title="中止任务" @click="store.cancel">
          <Square :size="15" fill="currentColor" />
        </button>
        <button v-else type="button" class="send-control" title="发送任务" :disabled="!canSend" @click="submit">
          <Send :size="16" />
        </button>
      </div>
    </div>
    <p class="composer-caption">2pi 可能会出错，请检查重要改动。</p>
  </footer>
</template>
