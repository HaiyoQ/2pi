<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Check, ChevronDown, LockKeyhole, Plus, Search, Settings2, Trash2, X } from 'lucide-vue-next'
import type { ConnectionTestResult, ProviderDraft, ProviderProfile, ProviderProtocol } from '../../../shared/contracts'
import { useAgentStore } from '../stores/agent'

const emit = defineEmits<{ close: [] }>()
const store = useAgentStore()
const selectedProviderId = ref('')
const draft = ref<ProviderDraft>()
const apiKey = ref('')
const providerSearch = ref('')
const providerPickerVisible = ref(false)
const testing = ref(false)
const testResult = ref<ConnectionTestResult>()

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

onMounted(() => {
  const id = store.settings?.activeModel?.providerId || store.settings?.providers[0]?.id
  if (id) selectProvider(id)
  else startCustom()
})

watch(providerPickerVisible, (visible) => {
  if (visible) providerSearch.value = ''
})

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
    type: 'custom',
    name: '自定义供应商',
    protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [{ id: '', name: '', reasoning: false }],
    headers: []
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
    id: item.id,
    type: 'builtin',
    name: item.name,
    protocol: item.protocol,
    baseUrl: item.baseUrl,
    models: item.models.map((model) => ({ ...model })),
    headers: []
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
    models: draft.value.models
      .filter((model) => model.id.trim())
      .map((model) => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim() })),
    headers: draft.value.headers
      .filter((header) => header.name.trim())
      .map((header) => ({ ...header, name: header.name.trim() }))
  }
}

async function saveProvider(): Promise<void> {
  const value = normalizedDraft()
  if (!value) return
  try {
    await store.saveProvider(value)
    const saved = value.id
      ? store.settings?.providers.find((item) => item.id === value.id)
      : store.settings?.providers.at(-1)
    if (saved) selectProvider(saved.id)
    ElMessage.success('供应商设置已保存')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
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
  } finally {
    testing.value = false
  }
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
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

function profileDraft(profile: ProviderProfile): ProviderDraft {
  return {
    id: profile.id,
    type: profile.type,
    name: profile.name,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    models: profile.models.map((model) => ({ ...model })),
    headers: profile.headers.map((header) => ({ name: header.name }))
  }
}

function protocolLabel(protocol: ProviderProtocol): string {
  return ({
    'openai-chat': 'OpenAI Chat',
    'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages',
    'google-generative-ai': 'Google Generative AI'
  })[protocol]
}

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
</script>

<template>
  <section class="settings-workspace">
    <header class="workspace-header settings-header">
      <button class="icon-action" type="button" title="返回任务" @click="emit('close')"><ArrowLeft :size="17" /></button>
      <div><h1>设置</h1><p>全局配置 · 保存后从下一次任务开始生效</p></div>
    </header>

    <div class="settings-layout">
      <aside class="settings-navigation" aria-label="设置页面">
        <button type="button" class="active"><Settings2 :size="16" /><span>模型供应商</span></button>
        <div class="settings-storage-note">
          <LockKeyhole :size="15" />
          <span>密钥仅在 Electron 主进程解密。</span>
        </div>
      </aside>

      <main class="settings-content">
        <div v-if="locked" class="runtime-lock">
          <LockKeyhole :size="15" /><span><strong>任务运行期间设置已锁定</strong>停止或等待当前任务完成后再修改。</span>
        </div>

        <div class="settings-content-inner">
          <header class="settings-title">
            <h2>模型供应商</h2>
            <p>管理用于 Agent 的连接、密钥和模型。配置保存在本机设置文件中。</p>
          </header>

          <section class="provider-selector-section">
            <label>供应商</label>
            <el-popover v-model:visible="providerPickerVisible" trigger="click" placement="bottom-start" :width="420" popper-class="provider-picker-popper">
              <template #reference>
                <button type="button" class="provider-picker-trigger" :aria-expanded="providerPickerVisible">
                  <span v-if="selectedProfile" class="provider-picker-value"><strong>{{ selectedProfile.name }}</strong><small>{{ protocolLabel(selectedProfile.protocol) }}</small></span>
                  <span v-else-if="draft" class="provider-picker-value"><strong>{{ draft.name }}</strong><small>{{ draft.id ? '待添加的内置供应商' : '待添加的自定义供应商' }}</small></span>
                  <span v-else class="provider-picker-placeholder">选择或添加供应商</span>
                  <span v-if="selectedProfile && store.settings?.activeModel?.providerId === selectedProfile.id" class="status-label success">使用中</span>
                  <ChevronDown :size="16" />
                </button>
              </template>
              <div class="provider-picker" @keydown.esc="providerPickerVisible = false">
                <el-input v-model="providerSearch" :prefix-icon="Search" clearable placeholder="搜索供应商" />
                <div class="provider-picker-scroll">
                  <div v-if="providerResults.length" class="provider-picker-group-label">已添加</div>
                  <button v-for="item in providerResults" :key="item.id" type="button" :class="{ selected: item.id === selectedProviderId }" @click="selectProvider(item.id)">
                    <span><strong>{{ item.name }}</strong><small>{{ protocolLabel(item.protocol) }}</small></span>
                    <Check v-if="item.id === selectedProviderId" :size="15" />
                  </button>
                  <div v-if="customProviderVisible || catalogResults.length" class="provider-picker-group-label provider-picker-add-label">添加供应商</div>
                  <button v-if="customProviderVisible" type="button" :disabled="locked" @click="startCustom">
                    <span><strong>自定义供应商</strong><small>OpenAI、Anthropic 或 Google 兼容接口</small></span><Plus :size="15" />
                  </button>
                  <button v-for="item in catalogResults" :key="`catalog-${item.id}`" type="button" :disabled="locked" @click="startBuiltin(item.id)">
                    <span><strong>{{ item.name }}</strong><small>{{ item.models.length }} 个模型 · {{ protocolLabel(item.protocol) }}</small></span><Plus :size="15" />
                  </button>
                  <div v-if="!providerResults.length && !customProviderVisible && !catalogResults.length" class="provider-picker-empty">没有匹配的供应商</div>
                </div>
              </div>
            </el-popover>
          </section>

          <template v-if="draft">
            <section class="settings-section provider-heading">
              <div><h3>{{ selectedProfile ? selectedProfile.name : draft.name }}</h3><p>{{ selectedProfile ? '编辑连接信息和可用模型。' : '完成配置后保存此供应商。' }}</p></div>
              <button v-if="selectedProfile" type="button" class="danger-text-button" :disabled="locked" @click="removeProvider"><Trash2 :size="14" />删除</button>
            </section>

            <section v-if="selectedProfile" class="active-model-row">
              <span><small>当前模型</small><strong>{{ store.settings?.activeModel?.providerId === selectedProfile.id ? activeModelLabel : '未使用此供应商' }}</strong></span>
              <el-select :model-value="store.settings?.activeModel?.providerId === selectedProfile.id ? store.settings.activeModel.modelId : ''" placeholder="选择模型" :disabled="locked" @change="activate(selectedProfile.id, String($event))">
                <el-option v-for="model in selectedProfile.models" :key="model.id" :label="model.name" :value="model.id" />
              </el-select>
            </section>

            <el-form label-position="top" :disabled="locked" class="provider-form">
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
              <p v-if="!draft.headers.length" class="inline-empty">没有自定义请求头</p>
              <div v-for="(header, index) in draft.headers" :key="index" class="header-row"><el-input v-model="header.name" placeholder="Header 名称" /><el-input v-model="header.value" :placeholder="selectedProfile?.headers.some(item => item.name === header.name) ? '已保存，留空则不修改' : 'Header 值'" type="password" show-password /><el-button text :icon="X" title="删除请求头" @click="draft.headers.splice(index, 1)" /></div>

              <div class="section-heading"><span>模型</span><el-button text :icon="Plus" @click="addModel">手动添加</el-button></div>
              <div v-for="(model, index) in draft.models" :key="index" class="model-row"><el-input v-model="model.id" placeholder="模型 ID" /><el-input v-model="model.name" placeholder="显示名称（可选）" /><el-checkbox v-model="model.reasoning">推理</el-checkbox><el-button text :icon="X" title="删除模型" @click="draft.models.splice(index, 1)" /></div>
            </el-form>

            <div class="connection-test-row">
              <el-button :loading="testing" :disabled="locked" @click="testConnection">测试连接并获取模型</el-button>
              <span>失败不会阻止保存，可继续手动填写模型。</span>
            </div>
            <el-alert v-if="testResult" :title="testResult.message" :type="testResult.ok ? 'success' : 'error'" show-icon :closable="false" />
            <div v-if="testResult?.models.length" class="discovered-models"><button v-for="model in testResult.models" :key="model.id" type="button" :disabled="draft.models.some(item => item.id === model.id)" @click="addDiscoveredModel(model.id)"><span><strong>{{ model.name }}</strong><small>{{ model.id }}</small></span><Plus :size="14" /></button></div>
          </template>
        </div>

        <footer class="settings-footer">
          <button type="button" class="secondary-command" @click="emit('close')">返回任务</button>
          <button v-if="draft" type="button" class="primary-command" :disabled="locked || !draft.name || !draft.baseUrl || !draft.models.some(item => item.id.trim())" @click="saveProvider">保存更改</button>
        </footer>
      </main>
    </div>
  </section>
</template>
