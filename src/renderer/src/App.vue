<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, FolderOpen, Plus, Send, Settings, Square, X } from 'lucide-vue-next'
import { useAgentStore } from './stores/agent'

const store = useAgentStore()
const prompt = ref('')
const settingsVisible = ref(false)
const provider = ref('openai')
const modelId = ref('gpt-5-mini')
const apiKey = ref('')
const messagePane = ref<HTMLElement>()

const pendingApprovals = computed(() => store.approvals.filter((item) => item.status === 'pending'))
const filteredModels = computed(() => store.models.filter((item) => item.provider === provider.value))

onMounted(async () => {
  try {
    await store.initialize()
    provider.value = store.settings?.model.provider ?? provider.value
    modelId.value = store.settings?.model.modelId ?? modelId.value
  } catch (error) {
    ElMessage.error(String(error))
  }
})

watch(() => store.messages.map((item) => item.text).join(''), async () => {
  await nextTick()
  if (messagePane.value) messagePane.value.scrollTop = messagePane.value.scrollHeight
})

async function submit(): Promise<void> {
  const text = prompt.value.trim()
  if (!text || store.running) return
  prompt.value = ''
  await store.send(text)
}

async function saveModel(): Promise<void> {
  await store.saveSettings(provider.value, modelId.value, apiKey.value.trim() || undefined)
  apiKey.value = ''
  settingsVisible.value = false
  ElMessage.success('模型设置已保存')
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand-row">
        <div class="brand-mark">2π</div>
        <span>编程助手</span>
        <el-button class="icon-button new-session" text :icon="Plus" title="新建会话" aria-label="新建会话" @click="store.createSession" />
      </div>

      <button class="workspace-button" type="button" aria-label="选择工作目录" @click="store.chooseWorkspace">
        <FolderOpen :size="17" />
        <span><strong>{{ store.workspaceName }}</strong><small>{{ store.settings?.workspace.path || '点击选择项目目录' }}</small></span>
      </button>

      <div class="sidebar-label">会话</div>
      <nav class="session-list">
        <button
          v-for="session in store.sessions"
          :key="session.id"
          type="button"
          :class="{ active: session.id === store.currentSession?.id }"
          @click="store.openSession(session.id)"
        >
          <span>{{ session.name }}</span>
          <small>{{ new Date(session.updatedAt).toLocaleDateString('zh-CN') }}</small>
        </button>
        <div v-if="!store.sessions.length" class="empty-list">还没有会话</div>
      </nav>

      <button class="settings-button" type="button" @click="settingsVisible = true">
        <Settings :size="17" /><span>模型设置</span>
        <small>{{ store.settings?.model.modelId }}</small>
      </button>
    </aside>

    <main class="main-panel">
      <header class="topbar">
        <div>
          <h1>{{ store.currentSession?.name || '新任务' }}</h1>
          <p>{{ store.settings?.workspace.path || '选择工作目录后开始' }}</p>
        </div>
        <el-tag v-if="store.running" type="warning" effect="plain">Agent 正在工作</el-tag>
      </header>

      <section ref="messagePane" class="messages">
        <div v-if="!store.messages.length" class="welcome-state">
          <div class="welcome-mark">2π</div>
          <h2>把任务交给本地编程 Agent</h2>
          <p>选择项目目录，描述需要完成的修改。</p>
        </div>
        <article v-for="message in store.messages" :key="message.id" :class="['message', message.role]">
          <div class="message-role">{{ message.role === 'user' ? '你' : 'Agent' }}</div>
          <div class="message-body">{{ message.text || (store.running ? '正在思考…' : '') }}</div>
        </article>

        <div v-if="store.toolEvents.length" class="tool-log">
          <div v-for="item in store.toolEvents" :key="item.id" :class="{ failed: item.error }">{{ item.label }}</div>
        </div>

        <div v-for="request in pendingApprovals" :key="request.requestId" class="approval-panel">
          <div>
            <strong>需要你的批准</strong>
            <p>{{ request.summary }}</p>
          </div>
          <div class="approval-actions">
            <el-button :icon="X" @click="store.decide(request, 'rejected')">拒绝</el-button>
            <el-button type="primary" :icon="Check" @click="store.decide(request, 'approved')">批准</el-button>
          </div>
        </div>

        <el-alert v-if="store.error" :title="store.error" type="error" show-icon :closable="false" />
      </section>

      <footer class="composer-wrap">
        <div class="composer">
          <textarea
            v-model="prompt"
            rows="3"
            aria-label="任务内容"
            placeholder="描述任务或下一步要求"
            :disabled="store.running"
            @keydown.ctrl.enter.prevent="submit"
          />
          <el-button v-if="store.running" class="send-button" :icon="Square" title="中止任务" aria-label="中止任务" @click="store.cancel" />
          <el-button v-else class="send-button" type="primary" :icon="Send" title="发送任务" aria-label="发送任务" :disabled="!prompt.trim()" @click="submit" />
        </div>
      </footer>
    </main>

    <el-dialog v-model="settingsVisible" title="模型设置" width="480px">
      <el-form label-position="top">
        <el-form-item label="服务商">
          <el-select v-model="provider" class="full-width" @change="modelId = filteredModels[0]?.modelId || ''">
            <el-option v-for="item in [...new Set(store.models.map(model => model.provider))]" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-select v-model="modelId" class="full-width" filterable>
            <el-option v-for="item in filteredModels" :key="item.modelId" :label="item.label" :value="item.modelId" />
          </el-select>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="apiKey" type="password" show-password :placeholder="store.settings?.hasApiKey ? '已安全保存，留空则不修改' : '输入 API Key'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!provider || !modelId" @click="saveModel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
