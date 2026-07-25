<script setup lang="ts">
import { computed, ref } from 'vue'
import { BrainCircuit, CornerUpLeft, Eye, Folder, ImagePlus, ListPlus, SendHorizontal, Settings2, X, Zap } from 'lucide-vue-next'
import type { PromptImage, QueuedMessageMode } from '../../../shared/contracts'
import { useAgentStore } from '../stores/agent'
import LoopMark from './LoopMark.vue'

const emit = defineEmits<{ openSettings: [] }>()
const store = useAgentStore()
const prompt = ref('')
const queueMode = ref<QueuedMessageMode>('steer')
const images = ref<PromptImage[]>([])
const imageInput = ref<HTMLInputElement>()

const activeModelLabel = computed(() => {
  const active = store.settings?.activeModel
  if (!active) return '选择模型'
  return store.models.find((model) => model.providerId === active.providerId && model.modelId === active.modelId)?.label || active.modelId
})
const executionLabel = computed(() => store.settings?.agent.executionMode === 'read-only' ? '只读' : '全自动')
const thinkingLabel = computed(() => ({
  minimal: '最少思考', low: '低思考', medium: '中等思考', high: '高思考', xhigh: '极高思考', max: '最大思考'
})[store.settings?.agent.thinkingLevel ?? 'medium'])
const activeModel = computed(() => {
  const active = store.settings?.activeModel
  return active ? store.models.find((model) => model.providerId === active.providerId && model.modelId === active.modelId) : undefined
})
const supportsImages = computed(() => activeModel.value?.input.includes('image') ?? false)

const canSubmit = computed(() => Boolean(
  (prompt.value.trim() || images.value.length)
  && !store.transitioning
  && !store.queueSubmitting
  && (!images.value.length || supportsImages.value)
  && (store.running || (store.settings?.activeModel && store.settings.workspace.path))
))

async function submit(): Promise<void> {
  const value = prompt.value.trim()
  if ((!value && !images.value.length) || !canSubmit.value) return
  const input = { text: value, images: [...images.value] }
  const accepted = store.running
    ? await store.queueMessage(input, queueMode.value)
    : await store.send(input)
  if (accepted && prompt.value.trim() === value) {
    prompt.value = ''
    images.value = []
  }
}

function openImagePicker(): void {
  imageInput.value?.click()
}

async function addImages(files: FileList | File[]): Promise<void> {
  if (store.running || !supportsImages.value) return
  const available = 4 - images.value.length
  for (const file of [...files].slice(0, available)) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) continue
    images.value.push({ mimeType: file.type as PromptImage['mimeType'], data: await readAsBase64(file) })
  }
}

function handleFiles(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.files) void addImages(target.files)
  target.value = ''
}

function handlePaste(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.files ?? [])]
  if (!files.length) return
  event.preventDefault()
  void addImages(files)
}

function removeImage(index: number): void {
  images.value.splice(index, 1)
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',', 2)[1] : undefined
      if (result) resolve(result)
      else reject(new Error('图片读取失败'))
    }
    reader.readAsDataURL(file)
  })
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
}
</script>

<template>
  <footer class="composer-zone">
    <section v-if="store.queuedMessages.length" class="pending-queue" aria-label="待处理消息">
      <header><span>待处理</span><strong>{{ store.queuedMessages.length }}</strong></header>
      <div v-for="item in store.queuedMessages" :key="item.id" class="pending-queue-row">
        <CornerUpLeft v-if="item.mode === 'steer'" :size="14" />
        <ListPlus v-else :size="14" />
        <span><strong>{{ item.mode === 'steer' ? '立即引导' : '排队继续' }}</strong><small>{{ item.text }}</small></span>
        <button type="button" class="icon-action" title="删除待处理消息" aria-label="删除待处理消息" :disabled="store.queueSubmitting" @click="store.removeQueuedMessage(item.id)"><X :size="14" /></button>
      </div>
    </section>
    <div class="composer-shell">
      <textarea
        v-model="prompt"
        rows="2"
        :placeholder="store.running ? '追加一条引导或后续任务' : store.settings?.activeModel ? '向 LOOP 描述任务' : '先配置模型，再开始任务'"
        :disabled="store.transitioning"
        @keydown="handleKeydown"
        @paste="handlePaste"
      />
      <div v-if="images.length" class="composer-images" aria-label="已添加图片">
        <div v-for="(image, index) in images" :key="`${image.mimeType}:${index}`" class="composer-image-preview">
          <img :src="`data:${image.mimeType};base64,${image.data}`" alt="待发送图片" />
          <button type="button" title="移除图片" aria-label="移除图片" @click="removeImage(index)"><X :size="12" /></button>
        </div>
      </div>
      <div class="composer-contracts">
        <input ref="imageInput" class="image-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple @change="handleFiles" />
        <button type="button" class="contract-control image-control" :class="{ unsupported: !supportsImages }" :title="supportsImages ? '添加图片，单张不超过 8 MiB，最多 4 张' : '当前模型不支持图片输入'" :disabled="store.running || store.transitioning || !supportsImages || images.length >= 4" @click="openImagePicker">
          <ImagePlus :size="14" /><span>{{ images.length ? `图片 ${images.length}/4` : '添加图片' }}</span>
        </button>
        <button type="button" class="contract-control" title="选择项目目录" :disabled="store.running || store.transitioning" @click="store.chooseWorkspace">
          <Folder :size="14" /><span>{{ store.workspaceName }}</span>
        </button>
        <button type="button" class="contract-control" title="打开模型设置" @click="emit('openSettings')">
          <Settings2 :size="14" /><span>{{ activeModelLabel }}</span>
        </button>
        <button type="button" class="contract-control" title="打开 Agent 设置" @click="emit('openSettings')">
          <Eye v-if="store.settings?.agent.executionMode === 'read-only'" :size="14" />
          <Zap v-else :size="14" /><span>{{ executionLabel }}</span>
        </button>
        <button type="button" class="contract-control" title="打开思考设置" @click="emit('openSettings')">
          <BrainCircuit :size="14" /><span>{{ thinkingLabel }}</span>
        </button>
        <div v-if="store.running" class="queue-mode-control" aria-label="追加消息方式">
          <button type="button" :class="{ active: queueMode === 'steer' }" :aria-pressed="queueMode === 'steer'" title="当前工具执行结束后立即引导 Agent" @click="queueMode = 'steer'"><CornerUpLeft :size="13" /><span>立即引导</span></button>
          <button type="button" :class="{ active: queueMode === 'follow-up' }" :aria-pressed="queueMode === 'follow-up'" title="当前任务自然结束后继续处理" @click="queueMode = 'follow-up'"><ListPlus :size="13" /><span>排队继续</span></button>
        </div>
        <button v-if="store.running" type="button" class="send-control queue-send" title="添加待处理消息" aria-label="添加待处理消息" :disabled="!canSubmit" @click="submit">
          <SendHorizontal :size="16" />
        </button>
        <button v-if="store.running" type="button" class="send-control stop" title="中止任务并清空待处理消息" aria-label="中止任务并清空待处理消息" @click="store.cancel">
          <LoopMark />
        </button>
        <button v-else type="button" class="send-control" title="发送任务" aria-label="发送任务" :disabled="!canSubmit" @click="submit">
          <LoopMark />
        </button>
      </div>
    </div>
    <p class="composer-caption">LOOP 可能会出错，请检查重要改动。</p>
  </footer>
</template>
