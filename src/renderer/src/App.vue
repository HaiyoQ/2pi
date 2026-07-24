<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, ChevronDown, FolderOpen, Plus, Search, Send, Settings, Square, Trash2, X } from 'lucide-vue-next'
import type { ConnectionTestResult, ProviderDraft, ProviderProfile, ProviderProtocol } from '../../shared/contracts'
import { useAgentStore } from './stores/agent'

const store = useAgentStore()
const prompt = ref('')
const settingsVisible = ref(false)
const selectedProviderId = ref('')
const draft = ref<ProviderDraft>()
const apiKey = ref('')
const providerSearch = ref('')
const providerPickerVisible = ref(false)
const testing = ref(false)
const testResult = ref<ConnectionTestResult>()
const messagePane = ref<HTMLElement>()

const pendingApprovals = computed(() => store.approvals.filter((item) => item.status === 'pending'))
const locked = computed(() => store.running || store.settings?.runtimeBusy)
const selectedProfile = computed(() => store.settings?.providers.find((item) => item.id === selectedProviderId.value))
const providerResults = computed(() => {
  const query = providerSearch.value.trim().toLowerCase()
  const providers = store.settings?.providers ?? []
  return query ? providers.filter((item) => `${item.name} ${item.id} ${protocolLabel(item.protocol)}`.toLowerCase().includes(query)) : providers
})
const catalogResults = computed(() => {
  const query = providerSearch.value.trim().toLowerCase()
  return query ? store.providerCatalog.filter((item) => `${item.name} ${item.id} ${protocolLabel(item.protocol)}`.toLowerCase().includes(query)) : store.providerCatalog
})
const customProviderVisible = computed(() => !providerSearch.value.trim()
  || '自定义供应商 openai anthropic google 兼容接口'.includes(providerSearch.value.trim().toLowerCase()))
const activeModelLabel = computed(() => {
  const active = store.settings?.activeModel
  if (!active) return '未选择模型'
  const provider = store.settings?.providers.find((item) => item.id === active.providerId)
  const model = provider?.models.find((item) => item.id === active.modelId)
  return `${model?.name || active.modelId} · ${provider?.name || active.providerId}`
})

onMounted(async () => {
  try { await store.initialize() } catch (error) { ElMessage.error(errorText(error)) }
})

watch(() => store.messages.map((item) => item.text).join(''), async () => {
  await nextTick()
  if (messagePane.value) messagePane.value.scrollTop = messagePane.value.scrollHeight
})

watch(providerPickerVisible, (visible) => {
  if (visible) providerSearch.value = ''
})

function openSettings(): void {
  settingsVisible.value = true
  const id = store.settings?.activeModel?.providerId || store.settings?.providers[0]?.id || ''
  if (id) selectProvider(id)
  else startCustom()
}

function selectProvider(id: string): void {
  const profile = store.settings?.providers.find((item) => item.id === id)
  if (!profile) return
  selectedProviderId.value = id
  draft.value = profileDraft(profile)
  apiKey.value = ''
  testResult.value = undefined
  providerPickerVisible.value = false
}

function startCustom(): void {
  draft.value = {
    type: 'custom', name: '自定义供应商', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:11434/v1',
    models: [{ id: '', name: '', reasoning: false }], headers: []
  }
  selectedProviderId.value = ''
  apiKey.value = ''
  testResult.value = undefined
  providerPickerVisible.value = false
}

function startBuiltin(id: string): void {
  const item = store.providerCatalog.find((entry) => entry.id === id)
  if (!item) return
  draft.value = {
    id: item.id, type: 'builtin', name: item.name, protocol: item.protocol, baseUrl: item.baseUrl,
    models: item.models.map((model) => ({ ...model })), headers: []
  }
  selectedProviderId.value = ''
  apiKey.value = ''
  testResult.value = undefined
  providerPickerVisible.value = false
}

function addModel(): void {
  draft.value?.models.push({ id: '', name: '', reasoning: false })
}

function addHeader(): void {
  draft.value?.headers.push({ name: '', value: '' })
}

function normalizedDraft(): ProviderDraft | undefined {
  if (!draft.value) return undefined
  return {
    ...draft.value,
    apiKey: apiKey.value.trim() || undefined,
    models: draft.value.models.filter((model) => model.id.trim()).map((model) => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim() })),
    headers: draft.value.headers.filter((header) => header.name.trim()).map((header) => ({ ...header, name: header.name.trim() }))
  }
}

async function saveProvider(): Promise<void> {
  const value = normalizedDraft()
  if (!value) return
  try {
    await store.saveProvider(value)
    const saved = value.id ? store.settings?.providers.find((item) => item.id === value.id)
      : store.settings?.providers.at(-1)
    if (saved) selectProvider(saved.id)
    ElMessage.success('供应商设置已保存')
  } catch (error) { ElMessage.error(errorText(error)) }
}

async function testConnection(): Promise<void> {
  const value = normalizedDraft()
  if (!value) return
  testing.value = true
  testResult.value = undefined
  try {
    testResult.value = await store.testProvider(value)
  } catch (error) {
    testResult.value = { ok: false, message: errorText(error), models: [] }
  } finally { testing.value = false }
}

function addDiscoveredModel(id: string): void {
  const model = testResult.value?.models.find((item) => item.id === id)
  if (!model || !draft.value || draft.value.models.some((item) => item.id === id)) return
  draft.value.models.push({ ...model })
}

async function removeProvider(): Promise<void> {
  const profile = selectedProfile.value
  if (!profile) return
  try {
    await ElMessageBox.confirm(`删除“${profile.name}”？会话记录不会被删除。`, '删除供应商', { type: 'warning' })
    await store.deleteProvider(profile.id)
    const next = store.settings?.providers[0]
    if (next) selectProvider(next.id)
    else startCustom()
    ElMessage.success('供应商已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(errorText(error))
  }
}

async function activate(providerId: string, modelId: string): Promise<void> {
  try {
    await store.activateModel({ providerId, modelId })
    ElMessage.success('当前模型已切换，会话历史已保留')
  } catch (error) { ElMessage.error(errorText(error)) }
}

async function submit(): Promise<void> {
  const text = prompt.value.trim()
  if (!text || store.running) return
  if (await store.send(text)) prompt.value = ''
}

function profileDraft(profile: ProviderProfile): ProviderDraft {
  return {
    id: profile.id, type: profile.type, name: profile.name, protocol: profile.protocol, baseUrl: profile.baseUrl,
    models: profile.models.map((model) => ({ ...model })),
    headers: profile.headers.map((header) => ({ name: header.name }))
  }
}

function protocolLabel(protocol: ProviderProtocol): string {
  return ({
    'openai-chat': 'OpenAI Chat', 'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages', 'google-generative-ai': 'Google Generative AI'
  })[protocol]
}

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand-row">
        <div class="brand-mark">2π</div><span>编程助手</span>
        <el-button class="icon-button new-session" text :icon="Plus" title="新建会话" @click="store.createSession" />
      </div>
      <button class="workspace-button" type="button" @click="store.chooseWorkspace">
        <FolderOpen :size="17" /><span><strong>{{ store.workspaceName }}</strong><small>{{ store.settings?.workspace.path || '点击选择项目目录' }}</small></span>
      </button>
      <div class="sidebar-label">会话</div>
      <nav class="session-list">
        <button v-for="session in store.sessions" :key="session.id" type="button" :class="{ active: session.id === store.currentSession?.id }" @click="store.openSession(session.id)">
          <span>{{ session.name }}</span><small>{{ new Date(session.updatedAt).toLocaleDateString('zh-CN') }}</small>
        </button>
        <div v-if="!store.sessions.length" class="empty-list">还没有会话</div>
      </nav>
      <button class="settings-button" type="button" @click="openSettings">
        <Settings :size="17" /><span>设置</span><small>{{ activeModelLabel }}</small>
      </button>
    </aside>

    <main class="main-panel">
      <header class="topbar">
        <div><h1>{{ store.currentSession?.name || '新任务' }}</h1><p>{{ store.settings?.workspace.path || '选择工作目录后开始' }}</p></div>
        <el-tag v-if="store.running" type="warning" effect="plain">Agent 正在工作</el-tag>
      </header>
      <section ref="messagePane" class="messages">
        <div v-if="!store.messages.length" class="welcome-state">
          <div class="welcome-mark">2π</div><h2>把任务交给本地编程 Agent</h2>
          <p>{{ store.settings?.activeModel ? '选择项目目录，描述需要完成的修改。' : '先在模型设置中添加供应商并选择模型。' }}</p>
        </div>
        <article v-for="message in store.messages" :key="message.id" :class="['message', message.role]">
          <div class="message-role">{{ message.role === 'user' ? '你' : 'Agent' }}</div>
          <div class="message-body">{{ message.text || (store.running ? '正在思考…' : '') }}</div>
        </article>
        <div v-if="store.toolEvents.length" class="tool-log"><div v-for="item in store.toolEvents" :key="item.id" :class="{ failed: item.error }">{{ item.label }}</div></div>
        <div v-for="request in pendingApprovals" :key="request.requestId" class="approval-panel">
          <div><strong>需要你的批准</strong><p>{{ request.summary }}</p></div>
          <div class="approval-actions"><el-button :icon="X" @click="store.decide(request, 'rejected')">拒绝</el-button><el-button type="primary" :icon="Check" @click="store.decide(request, 'approved')">批准</el-button></div>
        </div>
        <el-alert v-if="store.error" :title="store.error" type="error" show-icon :closable="false" />
      </section>
      <footer class="composer-wrap"><div class="composer">
        <textarea v-model="prompt" rows="3" placeholder="描述任务或下一步要求" :disabled="store.running" @keydown.ctrl.enter.prevent="submit" />
        <el-button v-if="store.running" class="send-button" :icon="Square" title="中止任务" @click="store.cancel" />
        <el-button v-else class="send-button" type="primary" :icon="Send" title="发送任务" :disabled="!prompt.trim() || !store.settings?.activeModel" @click="submit" />
      </div></footer>
    </main>

    <el-dialog v-model="settingsVisible" title="设置" width="940px" class="provider-dialog" destroy-on-close>
      <div v-if="locked" class="runtime-lock"><el-tag type="warning">运行中不可修改</el-tag><span>中止或等待当前任务完成后再编辑供应商和模型。</span></div>
      <div class="settings-center">
        <aside class="settings-nav" aria-label="设置页面">
          <button type="button" class="active" aria-current="page"><Settings :size="16" /><span>模型设置</span></button>
        </aside>

        <section class="settings-page">
          <header class="settings-page-header"><div><h3>模型设置</h3><p>选择供应商并配置用于 Agent 的模型。</p></div></header>

          <div class="settings-page-scroll">
            <div class="provider-selector-section">
              <label>供应商</label>
              <el-popover v-model:visible="providerPickerVisible" trigger="click" placement="bottom-start" :width="420" popper-class="provider-picker-popper">
              <template #reference>
                <button type="button" class="provider-picker-trigger" :aria-expanded="providerPickerVisible">
                  <span v-if="selectedProfile" class="provider-picker-value"><strong>{{ selectedProfile.name }}</strong><small>{{ protocolLabel(selectedProfile.protocol) }}</small></span>
                  <span v-else-if="draft" class="provider-picker-value"><strong>{{ draft.name }}</strong><small>{{ draft.id ? '待添加的内置供应商' : '待添加的自定义供应商' }}</small></span>
                  <span v-else class="provider-picker-placeholder">选择或添加供应商</span>
                  <el-tag v-if="selectedProfile && store.settings?.activeModel?.providerId === selectedProfile.id" size="small" type="success">使用中</el-tag>
                  <ChevronDown :size="16" />
                </button>
              </template>
              <div class="provider-picker" @keydown.esc="providerPickerVisible = false">
                <el-input v-model="providerSearch" :prefix-icon="Search" clearable placeholder="搜索供应商" />
                <div class="provider-picker-scroll">
                  <div v-if="providerResults.length" class="provider-picker-group-label">已添加</div>
                  <button
                    v-for="item in providerResults"
                    :key="item.id"
                    type="button"
                    :class="{ selected: item.id === selectedProviderId }"
                    @click="selectProvider(item.id)"
                  >
                    <span><strong>{{ item.name }}</strong><small>{{ protocolLabel(item.protocol) }}</small></span>
                    <Check v-if="item.id === selectedProviderId" :size="15" />
                  </button>

                  <div v-if="customProviderVisible || catalogResults.length" class="provider-picker-group-label provider-picker-add-label">添加供应商</div>
                  <button v-if="customProviderVisible" type="button" class="provider-picker-new" :disabled="locked" @click="startCustom">
                    <span><strong>自定义供应商</strong><small>OpenAI、Anthropic 或 Google 兼容接口</small></span><Plus :size="15" />
                  </button>
                  <button v-for="item in catalogResults" :key="`catalog-${item.id}`" type="button" class="provider-picker-new" :disabled="locked" @click="startBuiltin(item.id)">
                    <span><strong>{{ item.name }}</strong><small>{{ item.models.length }} 个模型 · {{ protocolLabel(item.protocol) }}</small></span><Plus :size="15" />
                  </button>
                  <div v-if="!providerResults.length && !customProviderVisible && !catalogResults.length" class="provider-picker-empty">没有匹配的供应商</div>
                </div>
              </div>
              </el-popover>
            </div>

            <template v-if="draft">
            <div class="provider-config-heading">
              <div><h4>{{ selectedProfile ? selectedProfile.name : draft.name }}</h4><p>{{ selectedProfile ? '编辑连接信息和可用模型。' : '完成配置后保存此供应商。' }}</p></div>
              <el-button v-if="selectedProfile" text type="danger" :icon="Trash2" :disabled="locked" @click="removeProvider">删除</el-button>
            </div>

            <div v-if="selectedProfile" class="active-model-box">
              <span><small>当前正在使用</small><strong>{{ store.settings?.activeModel?.providerId === selectedProfile.id ? activeModelLabel : '未使用此供应商' }}</strong></span>
              <el-select :model-value="store.settings?.activeModel?.providerId === selectedProfile.id ? store.settings.activeModel.modelId : ''" placeholder="选择并切换模型" :disabled="locked" @change="activate(selectedProfile.id, String($event))">
                <el-option v-for="model in selectedProfile.models" :key="model.id" :label="model.name" :value="model.id" />
              </el-select>
            </div>

            <el-form label-position="top" :disabled="locked">
              <div class="form-grid">
                <el-form-item label="显示名称"><el-input v-model="draft.name" /></el-form-item>
                <el-form-item label="协议"><el-select v-model="draft.protocol" class="full-width"><el-option label="OpenAI Chat" value="openai-chat" /><el-option label="OpenAI Responses" value="openai-responses" /><el-option label="Anthropic Messages" value="anthropic-messages" /><el-option label="Google Generative AI" value="google-generative-ai" /></el-select></el-form-item>
              </div>
              <el-form-item label="Base URL"><el-input v-model="draft.baseUrl" placeholder="https://api.example.com/v1" /></el-form-item>
              <el-form-item label="API Key">
                <el-input v-model="apiKey" type="password" show-password :disabled="draft.clearApiKey" :placeholder="selectedProfile?.hasApiKey ? '已安全保存，留空则不修改' : '可留空（适用于本地免认证服务）'" />
                <el-checkbox v-if="selectedProfile?.hasApiKey" v-model="draft.clearApiKey" class="clear-secret">删除已保存的 API Key</el-checkbox>
              </el-form-item>

              <div class="section-heading"><span>请求头</span><el-button text :icon="Plus" @click="addHeader">添加</el-button></div>
              <div v-if="!draft.headers.length" class="inline-empty">没有自定义请求头</div>
              <div v-for="(header, index) in draft.headers" :key="index" class="header-row"><el-input v-model="header.name" placeholder="Header 名称" /><el-input v-model="header.value" :placeholder="selectedProfile?.headers.some(item => item.name === header.name) ? '已保存，留空则不修改' : 'Header 值'" type="password" show-password /><el-button text :icon="X" @click="draft.headers.splice(index, 1)" /></div>

              <div class="section-heading"><span>模型</span><el-button text :icon="Plus" @click="addModel">手动添加</el-button></div>
              <div v-for="(model, index) in draft.models" :key="index" class="model-row"><el-input v-model="model.id" placeholder="模型 ID" /><el-input v-model="model.name" placeholder="显示名称（可选）" /><el-checkbox v-model="model.reasoning">推理</el-checkbox><el-button text :icon="X" @click="draft.models.splice(index, 1)" /></div>
            </el-form>

            <div class="test-area">
              <el-button :loading="testing" :disabled="locked" @click="testConnection">测试连接并获取模型</el-button>
              <span class="test-help">失败不会阻止保存，可继续手动填写模型。</span>
            </div>
            <el-alert v-if="testResult" :title="testResult.message" :type="testResult.ok ? 'success' : 'error'" show-icon :closable="false" />
            <div v-if="testResult?.models.length" class="discovered-models"><button v-for="model in testResult.models" :key="model.id" type="button" :disabled="draft.models.some(item => item.id === model.id)" @click="addDiscoveredModel(model.id)"><span>{{ model.name }}</span><small>{{ model.id }}</small><Plus :size="14" /></button></div>
            </template>

          </div>

          <footer class="settings-page-footer">
            <el-button @click="settingsVisible = false">关闭</el-button>
            <el-button v-if="draft" type="primary" :disabled="locked || !draft.name || !draft.baseUrl || !draft.models.some(item => item.id.trim())" @click="saveProvider">保存更改</el-button>
          </footer>
        </section>
      </div>
    </el-dialog>
  </div>
</template>
